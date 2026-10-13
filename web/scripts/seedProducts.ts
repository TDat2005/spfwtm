import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { PrismaClient } from "../src/generated/prisma/client.ts";
import { MediaService } from "../src/modules/media/application/MediaService.ts";
import { FetchRemoteImageDownloader } from "../src/modules/media/infrastructure/FetchRemoteImageDownloader.ts";
import { LocalMediaStorage } from "../src/modules/media/infrastructure/LocalMediaStorage.ts";
import { PrismaMediaAssetRepository } from "../src/modules/media/infrastructure/PrismaMediaAssetRepository.ts";
import { Sha256ContentHasher } from "../src/modules/media/infrastructure/Sha256ContentHasher.ts";
import { UPLOADED_PRODUCT_PREFIX } from "../src/modules/standalone/domain/UploadedImage.ts";
import { productTypeFor, sampleImage } from "./sampleImages.ts";

export const SEED_PREFIX = `${UPLOADED_PRODUCT_PREFIX}seed-`;
const INSERT_CHUNK = 1_000;

export interface SeedProductsOptions {
  count: number;
  /** Tiền tố product type. */
  type: string;
  /** Số sản phẩm mỗi product type. */
  perType: number;
  /** Số ảnh mẫu khác nhau dùng chung. */
  images: number;
  /** Cạnh ảnh mẫu (px). */
  size: number;
  onProgress?: (created: number) => void;
}

/** Thư mục ảnh của app khi chạy từ `web/`, giống MediaModule. */
export function localMediaStorage(): LocalMediaStorage {
  return new LocalMediaStorage(join(process.cwd(), "storage", "media"));
}

/**
 * Tạo sản phẩm "ảnh tải lên" (`upload-seed-...`) cho shop, nên luồng watermark đọc
 * ảnh từ storage cục bộ như ảnh thật và không gọi Shopify. Nhiều sản phẩm dùng
 * chung một bộ ảnh nhỏ. Trả về các product type đã tạo.
 */
export async function seedProducts(
  prisma: PrismaClient,
  shop: { id: string; domain: string },
  options: SeedProductsOptions,
): Promise<string[]> {
  const media = new MediaService(
    new FetchRemoteImageDownloader(),
    localMediaStorage(),
    new Sha256ContentHasher(),
    new PrismaMediaAssetRepository(prisma),
  );
  const imageUrls: string[] = [];
  for (let i = 0; i < options.images; i++) {
    const asset = await media.storeUploaded(
      shop.domain,
      await sampleImage(i, options.images, options.size),
      "image/jpeg",
    );
    imageUrls.push(`/api/media/assets/${asset.id}/content`);
  }

  const runId = new Date().toISOString().slice(5, 16).replace("T", " ");
  const products = Array.from({ length: options.count }, (_, i) => {
    const imageUrl = imageUrls[i % imageUrls.length]!;
    return {
      shopId: shop.id,
      shopifyProductId: `${SEED_PREFIX}${randomUUID()}`,
      title: `Sản phẩm thử #${i + 1} (${runId})`,
      status: "ACTIVE" as const,
      productType: productTypeFor(i, options.count, options.perType, options.type),
      imageUrl,
      originalImageUrl: imageUrl,
    };
  });
  for (let i = 0; i < products.length; i += INSERT_CHUNK) {
    await prisma.catalogProduct.createMany({ data: products.slice(i, i + INSERT_CHUNK) });
    options.onProgress?.(Math.min(i + INSERT_CHUNK, products.length));
  }
  return [...new Set(products.map((product) => product.productType))];
}
