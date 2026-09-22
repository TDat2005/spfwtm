import { randomUUID } from "node:crypto";
import {
  WatermarkJob,
  type WatermarkPosition,
} from "../domain/WatermarkJob.ts";
import type {
  ProductImageReader,
  WatermarkJobRepository,
} from "./WatermarkPorts.ts";

export interface CreateWatermarkJobInput {
  shopDomain: string;
  productId: string;
  watermarkType?: "TEXT" | "IMAGE";
  text?: string | null;
  logoUrl?: string | null;
  logoScale?: number;
  position: WatermarkPosition;
  opacity: number;
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
      watermarkType: input.watermarkType,
      text: input.text,
      logoUrl: input.logoUrl,
      logoScale: input.logoScale,
      position: input.position,
      opacity: input.opacity,
    });
    await this.repository.save(job);
    return job;
  }
}
