import { randomUUID } from "node:crypto";
import { WatermarkJob, type WatermarkLayerProps } from "../domain/WatermarkJob.ts";
import type {
  ProductImageReader,
  WatermarkJobRepository,
} from "./WatermarkPorts.ts";

export interface CreateWatermarkJobInput {
  shopDomain: string;
  productId: string;
  layers: ReadonlyArray<WatermarkLayerProps>;
}

export class CreateWatermarkJob {
  constructor(
    private readonly repository: WatermarkJobRepository,
    private readonly productImages: ProductImageReader
  ) {}

  async execute(input: CreateWatermarkJobInput): Promise<WatermarkJob> {
    const imageUrl = await this.productImages.findImageUrl(
      input.shopDomain,
      input.productId
    );
    if (!imageUrl)
      throw new Error("Sản phẩm không có ảnh hoặc chưa được đồng bộ");

    const job = new WatermarkJob({
      id: randomUUID(),
      shopDomain: input.shopDomain,
      productId: input.productId,
      sourceImageUrl: imageUrl,
      design: input.layers,
    });
    await this.repository.save(job);
    return job;
  }
}
