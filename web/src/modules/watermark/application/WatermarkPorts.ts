import type {
  WatermarkConfiguration,
  WatermarkJob,
} from "../domain/WatermarkJob.ts";

export interface WatermarkJobRepository {
  save(job: WatermarkJob): Promise<void>;
  findByIdForShop(id: string, shopDomain: string): Promise<WatermarkJob | null>;
  listByShop(shopDomain: string): Promise<WatermarkJob[]>;
}

export interface ProductImageReader {
  findImageUrl(shopDomain: string, productId: string): Promise<string | null>;
}

export interface WatermarkProcessor {
  applyText(input: {
    source: Buffer;
    configuration: WatermarkConfiguration;
  }): Promise<{ bytes: Buffer; mimeType: string }>;

  applyImage(input: {
    source: Buffer;
    logo: Buffer;
    configuration: WatermarkConfiguration;
  }): Promise<{ bytes: Buffer; mimeType: string }>;
}

export interface WatermarkMediaGateway {
  importSource(shopDomain: string, sourceUrl: string): Promise<Buffer>;
  storeResult(
    shopDomain: string,
    bytes: Buffer,
    mimeType: string
  ): Promise<string>;
}
