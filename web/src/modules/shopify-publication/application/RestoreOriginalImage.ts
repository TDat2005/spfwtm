import type { PublishedMediaRepository } from "./PublishedMediaRepository.ts";
import type { ShopifyMediaGateway } from "./ShopifyMediaGateway.ts";

export interface RestoreOriginalImageInput {
  watermarkJobId: string;
  shopDomain: string;
}

export interface RestoreOriginalImageResult {
  productId: string;
  deletedMediaId: string;
}

export class RestoreOriginalImage {
  constructor(
    private readonly publishedMediaRepository: PublishedMediaRepository,
    private readonly shopifyMediaGateway: ShopifyMediaGateway
  ) {}

  async execute(
    input: RestoreOriginalImageInput
  ): Promise<RestoreOriginalImageResult> {
    if (!input.watermarkJobId.trim()) {
      throw new Error("RestoreOriginalImage: watermarkJobId không được để trống");
    }
    if (!input.shopDomain.trim()) {
      throw new Error("RestoreOriginalImage: shopDomain không được để trống");
    }

    const publishedMedia = await this.publishedMediaRepository.findByJobId(
      input.watermarkJobId,
      input.shopDomain
    );

    if (!publishedMedia) {
      throw new Error(
        `Không tìm thấy ảnh xuất bản cho job ${input.watermarkJobId}`
      );
    }

    await this.shopifyMediaGateway.deleteMedia(publishedMedia.productId, [
      publishedMedia.shopifyMediaId,
    ]);

    await this.publishedMediaRepository.delete(publishedMedia.id);

    return {
      productId: publishedMedia.productId,
      deletedMediaId: publishedMedia.shopifyMediaId,
    };
  }
}
