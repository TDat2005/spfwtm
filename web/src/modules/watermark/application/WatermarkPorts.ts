import type { WatermarkDesign, WatermarkJob } from "../domain/WatermarkJob.ts";

export interface WatermarkJobHistoryItem {
  job: WatermarkJob;
  productTitle: string;
  /** Ảnh kết quả của job đang là ảnh đã đưa lên Shopify. */
  published: boolean;
}

export interface WatermarkJobRepository {
  save(job: WatermarkJob): Promise<void>;
  findByIdForShop(id: string, shopDomain: string): Promise<WatermarkJob | null>;
  /** Job mới nhất trước. */
  listPageByShop(
    shopDomain: string,
    range: { offset: number; limit: number }
  ): Promise<{ items: WatermarkJobHistoryItem[]; total: number }>;
}

export interface ProductImageReader {
  findImageUrl(shopDomain: string, productId: string): Promise<string | null>;
}

export interface WatermarkProcessor {
  /** Render mọi lớp đang bật của design lên ảnh nguồn trong một lần encode. */
  render(input: {
    source: Buffer;
    design: WatermarkDesign;
    /** Bytes của logo theo đúng URL trong design.logoUrls. */
    logos: ReadonlyMap<string, Buffer>;
  }): Promise<{ bytes: Buffer; mimeType: string }>;
}

export interface WatermarkMediaGateway {
  importSource(shopDomain: string, sourceUrl: string): Promise<Buffer>;
  /** Logo dùng lại cho rất nhiều job nên được cache, không tải/lưu lại mỗi job. */
  importLogo(shopDomain: string, logoUrl: string): Promise<Buffer>;
  storeResult(
    shopDomain: string,
    bytes: Buffer,
    mimeType: string
  ): Promise<string>;
}
