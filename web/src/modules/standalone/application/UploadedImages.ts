import { randomUUID } from "node:crypto";
import {
  detectImageType,
  imageProductType,
  imageTitle,
  MAX_UPLOAD_BYTES,
  UPLOADED_PRODUCT_PREFIX,
} from "../domain/UploadedImage.ts";
import type { UploadedImageStore, UploadedProductCatalog } from "./StandalonePorts.ts";

export interface UploadedImageProduct {
  id: string;
  title: string;
  imageUrl: string;
}

/** Tải một ảnh lên và biến nó thành "sản phẩm" để dùng chung luồng watermark. */
export class UploadImageProduct {
  constructor(
    private readonly images: UploadedImageStore,
    private readonly catalog: UploadedProductCatalog,
  ) {}

  async execute(input: {
    shopDomain: string;
    bytes: Buffer;
    title: unknown;
    productType: unknown;
  }): Promise<UploadedImageProduct> {
    if (input.bytes.length === 0) throw new Error("File ảnh trống");
    if (input.bytes.length > MAX_UPLOAD_BYTES) {
      throw new Error(`Ảnh vượt quá ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB`);
    }
    const mimeType = detectImageType(input.bytes);
    if (!mimeType) throw new Error("Chỉ hỗ trợ ảnh JPEG, PNG, WebP hoặc GIF");

    const asset = await this.images.storeUploaded(input.shopDomain, input.bytes, mimeType);
    const product = {
      id: `${UPLOADED_PRODUCT_PREFIX}${randomUUID()}`,
      title: imageTitle(input.title),
      productType: imageProductType(input.productType),
      imageUrl: `/api/media/assets/${asset.id}/content`,
    };
    await this.catalog.add(input.shopDomain, product);
    return { id: product.id, title: product.title, imageUrl: product.imageUrl };
  }
}

export class RemoveImageProduct {
  constructor(private readonly catalog: UploadedProductCatalog) {}

  async execute(shopDomain: string, productId: string): Promise<void> {
    // Chỉ cho xóa ảnh tải lên, không đụng tới sản phẩm đồng bộ từ Shopify.
    if (!productId.startsWith(UPLOADED_PRODUCT_PREFIX)) throw new Error("Không tìm thấy ảnh");
    if (!(await this.catalog.remove(shopDomain, productId))) throw new Error("Không tìm thấy ảnh");
  }
}
