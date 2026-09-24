import { randomUUID } from "crypto";
import { PublishedMedia } from "../domain/PublishedMedia.ts";
import type { PublishedMediaRepository } from "./PublishedMediaRepository.ts";
import type { WatermarkResultReader } from "./WatermarkResultReader.ts";
import type { ShopifyMediaGateway } from "./ShopifyMediaGateway.ts";
import type { PublicationAttemptRepository } from "../../product-media-sync/application/PublicationAttemptRepository.ts";

export interface PublishWatermarkedImageInput {
    watermarkJobId: string;
    shopDomain: string;
    altText: string;
}
export class PublishWatermarkedImage {
    constructor(
        private readonly watermarkResultReader: WatermarkResultReader,
        private readonly shopifyMediaGateway: ShopifyMediaGateway,
        private readonly publishedMediaRepository: PublishedMediaRepository,
        private readonly publicationAttempts: PublicationAttemptRepository,
    ) { }
    async execute(
        input: PublishWatermarkedImageInput,): Promise<PublishedMedia> {
        if (!input.watermarkJobId.trim()) {
            throw new Error("PublishWatermarkedImage: watermarkJobId không được để trống");
        }
        if (!input.shopDomain.trim()) {
            throw new Error("PublishWatermarkedImage: shopDomain không được để trống");
        }
        const existingMedia = await this.publishedMediaRepository.findByJobId(input.watermarkJobId, input.shopDomain);
        if (existingMedia) {
            await this.shopifyMediaGateway.promoteMedia(
                existingMedia.productId,
                existingMedia.shopifyMediaId,
            );
            return existingMedia;
        }
        const watermarkResult = await this.watermarkResultReader.read(input.watermarkJobId, input.shopDomain);
        if (!watermarkResult) {
            throw new Error(`PublishWatermarkedImage: Không tìm thấy watermark result với watermarkJobId: ${input.watermarkJobId} và shopDomain: ${input.shopDomain}`);
        }
        const attemptId = randomUUID();
        await this.publicationAttempts.start({
            id: attemptId,
            shopDomain: input.shopDomain,
            productId: watermarkResult.productId,
            watermarkJobId: input.watermarkJobId,
        });

        try {
            const publishResult = await this.shopifyMediaGateway.publish({
                productId: watermarkResult.productId,
                bytes: watermarkResult.bytes,
                mimeType: watermarkResult.mimeType,
                filename: `${watermarkResult.productId}.webp`,
                altText: input.altText.trim() || "Product image with watermark",
            });

            // Lưu dấu vết media trước khi reorder để webhook do app tạo luôn
            // được nhận diện, kể cả khi delivery đến rất nhanh.
            await this.publicationAttempts.recordMedia(
                attemptId,
                input.shopDomain,
                publishResult.mediaId,
            );
            const publishedMedia = new PublishedMedia({
                id: randomUUID(),
                shopDomain: input.shopDomain,
                watermarkJobId: input.watermarkJobId,
                productId: watermarkResult.productId,
                shopifyMediaId: publishResult.mediaId,
                imageUrl: publishResult.imageUrl,
            });
            await this.publishedMediaRepository.save(publishedMedia);
            await this.shopifyMediaGateway.promoteMedia(
                watermarkResult.productId,
                publishResult.mediaId,
            );
            await this.publicationAttempts.complete(attemptId, input.shopDomain);
            return publishedMedia;
        } catch (error) {
            await this.publicationAttempts.fail(attemptId, input.shopDomain);
            throw error;
        }
    }
}
