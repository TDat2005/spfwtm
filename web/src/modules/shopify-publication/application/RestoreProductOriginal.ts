import type { ShopifyMediaGateway } from "./ShopifyMediaGateway.ts";

export interface RestoreProductOriginalInput {
  productId: string;
  shopDomain: string;
}

export interface RestoreProductOriginalResult {
  productId: string;
  /** URL ảnh chính trên Shopify sau khi khôi phục (null nếu sản phẩm không còn ảnh). */
  restoredImageUrl: string | null;
  /** Các media của app đã bị xóa khỏi Shopify trong lần khôi phục này. */
  deletedMediaIds: string[];
  /** Media của app đã biến mất khỏi Shopify từ trước, chỉ dọn bản ghi. */
  alreadyRemovedMediaIds: string[];
  /** Media bị giữ lại vì trùng ảnh gốc của merchant (sourceMediaId). */
  protectedMediaIds: string[];
}

export interface ProductMediaSnapshot {
  id: string;
  imageUrl: string | null;
}

/**
 * Sổ ghi media do chính app tạo. Đây là nguồn DUY NHẤT được phép quyết định
 * media nào có thể xóa khi khôi phục: không bao giờ suy luận từ URL hay vị trí.
 */
export interface AppMediaRegistry {
  /** Id media app đã upload cho sản phẩm: PublishedMedia + PublicationAttempt có shopifyMediaId. */
  listAppMediaIds(shopDomain: string, productId: string): Promise<string[]>;
  /** Xóa bản ghi PublishedMedia của đúng các media này (không đụng PublicationAttempt, đó là lịch sử). */
  forgetPublishedMedia(
    shopDomain: string,
    productId: string,
    mediaIds: string[],
  ): Promise<void>;
}

export interface ProductMediaReader {
  /** Toàn bộ media hiện có của sản phẩm trên Shopify (mọi trang). Ném lỗi nếu sản phẩm không tồn tại. */
  listMedia(productId: string): Promise<ProductMediaSnapshot[]>;
  /** Ảnh đầu tiên (theo vị trí) của sản phẩm, null nếu không còn ảnh. */
  readPrimaryImage(productId: string): Promise<ProductMediaSnapshot | null>;
}

export type ProductMediaDeleter = Pick<ShopifyMediaGateway, "deleteMedia">;

export interface CatalogSourceState {
  sourceMediaId: string | null;
  originalImageUrl: string | null;
}

export type CatalogRestoreUpdate =
  /** Ảnh gốc của merchant vẫn là ảnh chính: chỉ làm mới URL, giữ nguyên nguồn. */
  | { kind: "ORIGINAL_INTACT"; imageUrl: string | null }
  /** Ảnh chính hiện tại là ảnh khác của merchant: nhận làm nguồn mới (giống reconcile). */
  | {
      kind: "SOURCE_ADOPTED";
      mediaId: string;
      imageUrl: string | null;
      /** true khi nguồn cũ khác nguồn mới, cần tăng sourceVersion. */
      sourceChanged: boolean;
    }
  /** Sản phẩm không còn ảnh nào trên Shopify (giống PRIMARY_REMOVED). */
  | { kind: "NO_IMAGE"; hadSource: boolean };

export interface CatalogRestoreWriter {
  findSource(
    shopDomain: string,
    productId: string,
  ): Promise<CatalogSourceState | null>;
  applyRestore(
    shopDomain: string,
    productId: string,
    update: CatalogRestoreUpdate,
  ): Promise<void>;
}

/**
 * Khôi phục ảnh gốc của sản phẩm bằng cách xóa ảnh watermark do app tạo.
 *
 * Quy tắc xóa: chỉ xóa media có id nằm trong sổ của app (PublishedMedia và
 * PublicationAttempt) và còn tồn tại trên sản phẩm. Ảnh của merchant, kể cả ảnh
 * gốc (sourceMediaId) hay file đặt tên giống `wm-*`, không bao giờ bị xóa.
 */
export class RestoreProductOriginal {
  constructor(
    private readonly appMedia: AppMediaRegistry,
    private readonly productMedia: ProductMediaReader,
    private readonly mediaDeleter: ProductMediaDeleter,
    private readonly catalog: CatalogRestoreWriter,
  ) {}

  async execute(
    input: RestoreProductOriginalInput,
  ): Promise<RestoreProductOriginalResult> {
    const productId = input.productId.trim();
    const shopDomain = input.shopDomain.trim();
    if (!productId) {
      throw new Error("RestoreProductOriginal: productId không được để trống");
    }
    if (!shopDomain) {
      throw new Error("RestoreProductOriginal: shopDomain không được để trống");
    }

    const source = await this.catalog.findSource(shopDomain, productId);
    const appMediaIds = unique(
      await this.appMedia.listAppMediaIds(shopDomain, productId),
    );
    const liveMedia = await this.productMedia.listMedia(productId);
    const liveIds = new Set(liveMedia.map((media) => media.id));

    // Lớp bảo vệ thêm: dù sổ ghi nhầm, vẫn không bao giờ xóa ảnh gốc của merchant.
    const protectedId = source?.sourceMediaId ?? null;
    const protectedMediaIds = appMediaIds.filter((id) => id === protectedId);
    const candidates = appMediaIds.filter((id) => id !== protectedId);
    const toDelete = candidates.filter((id) => liveIds.has(id));
    const alreadyRemoved = candidates.filter((id) => !liveIds.has(id));

    if (toDelete.length > 0) {
      await this.deleteFromShopify(shopDomain, productId, toDelete);
    }

    const toForget = [...toDelete, ...alreadyRemoved];
    if (toForget.length > 0) {
      await this.appMedia.forgetPublishedMedia(shopDomain, productId, toForget);
    }

    const primary = await this.productMedia.readPrimaryImage(productId);
    const update = planCatalogUpdate(source, primary);
    if (source) {
      await this.catalog.applyRestore(shopDomain, productId, update);
    }

    return {
      productId,
      restoredImageUrl: restoredImageUrl(update, primary),
      deletedMediaIds: toDelete,
      alreadyRemovedMediaIds: alreadyRemoved,
      protectedMediaIds,
    };
  }

  private async deleteFromShopify(
    shopDomain: string,
    productId: string,
    mediaIds: string[],
  ): Promise<void> {
    try {
      await this.mediaDeleter.deleteMedia(productId, mediaIds);
    } catch (error) {
      // Shopify có thể đã xóa một phần trước khi báo lỗi: đọc lại để chỉ quên
      // bản ghi của những media đã thật sự biến mất, phần còn lại giữ để thử lại.
      await this.forgetRemovedAfterFailure(shopDomain, productId, mediaIds);
      throw error;
    }
  }

  private async forgetRemovedAfterFailure(
    shopDomain: string,
    productId: string,
    mediaIds: string[],
  ): Promise<void> {
    try {
      const stillThere = new Set(
        (await this.productMedia.listMedia(productId)).map((media) => media.id),
      );
      const gone = mediaIds.filter((id) => !stillThere.has(id));
      if (gone.length > 0) {
        await this.appMedia.forgetPublishedMedia(shopDomain, productId, gone);
      }
    } catch {
      // Không đọc lại được thì giữ nguyên bản ghi; lỗi gốc vẫn được ném ra.
    }
  }
}

/**
 * Quyết định cập nhật catalog sau khi chỉ xóa ảnh của app.
 *
 * Vì không còn xóa ảnh của merchant, ảnh chính còn lại phải là ảnh gốc của
 * merchant. Không ghi đè `originalImageUrl`/`sourceMediaId` một cách mù quáng:
 * - ảnh chính trùng sourceMediaId: giữ nguyên nguồn, chỉ làm mới URL;
 * - ảnh chính là ảnh khác của merchant (đã đổi thứ tự hoặc xóa ảnh gốc): nhận
 *   làm nguồn mới như luồng reconcile (MERCHANT_PRIMARY_CHANGED);
 * - không còn ảnh: xóa nguồn như PRIMARY_REMOVED, không giữ URL ảnh đã mất.
 */
export function planCatalogUpdate(
  source: CatalogSourceState | null,
  primary: ProductMediaSnapshot | null,
): CatalogRestoreUpdate {
  if (!primary) {
    return { kind: "NO_IMAGE", hadSource: source?.sourceMediaId != null };
  }
  if (source?.sourceMediaId && source.sourceMediaId === primary.id) {
    return {
      kind: "ORIGINAL_INTACT",
      imageUrl: primary.imageUrl ?? source.originalImageUrl,
    };
  }
  return {
    kind: "SOURCE_ADOPTED",
    mediaId: primary.id,
    imageUrl: primary.imageUrl,
    sourceChanged: source?.sourceMediaId != null,
  };
}

function restoredImageUrl(
  update: CatalogRestoreUpdate,
  primary: ProductMediaSnapshot | null,
): string | null {
  if (update.kind === "NO_IMAGE") return null;
  return update.imageUrl ?? primary?.imageUrl ?? null;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim() !== "")));
}
