import { randomUUID } from "crypto";
import { PublishedMedia } from "../domain/PublishedMedia.ts";
import type { PublishedMediaRepository } from "./PublishedMediaRepository.ts";
import type { WatermarkResultReader } from "./WatermarkResultReader.ts";
import type { ShopifyMediaGateway } from "./ShopifyMediaGateway.ts";

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
            return existingMedia;
        }
        const watermarkResult = await this.watermarkResultReader.read(input.watermarkJobId, input.shopDomain);
        if (!watermarkResult) {
            throw new Error(`PublishWatermarkedImage: Không tìm thấy watermark result với watermarkJobId: ${input.watermarkJobId} và shopDomain: ${input.shopDomain}`);
        }
        const publishResult = await this.shopifyMediaGateway.publish({
            productId: watermarkResult.productId,
            bytes: watermarkResult.bytes,
            mimeType: watermarkResult.mimeType,
            filename: `${watermarkResult.productId}.webp`,
            altText: input.altText.trim() || "Product image with watermark",
        });
        const publishedMedia = new PublishedMedia({
            id: randomUUID(),
            shopDomain: input.shopDomain,
            watermarkJobId: input.watermarkJobId,
            productId: watermarkResult.productId,
            shopifyMediaId: publishResult.mediaId,
            imageUrl: publishResult.imageUrl,
        });
        await this.publishedMediaRepository.save(publishedMedia);
        return publishedMedia;
    }
}
