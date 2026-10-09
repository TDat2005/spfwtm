import { createHash } from "node:crypto";
import type { EnqueueJobInput } from "../../jobs/application/EnqueueJob.ts";
import { PUBLICATION_RESTORE_PRODUCT_V1 } from "../../jobs/domain/JobDefinitions.ts";
import type { CatalogFilter } from "../../watermark/domain/CatalogFilter.ts";

/** Chọn tay tối đa ngần này sản phẩm (cùng giới hạn batch chọn tay). */
export const MAX_SELECTED_RESTORE = 1_000;

export type RestoreSelection =
  | { kind: "PRODUCT_IDS"; productIds: string[] }
  /** "Chọn tất cả sản phẩm khớp bộ lọc" trong studio. */
  | { kind: "FILTER"; filter: CatalogFilter };

export interface RestorableProductReader {
  /** Sản phẩm đang có ảnh watermark của app: đã publish hoặc ảnh chính là file `wm-`. */
  listRestorableProductIds(shopDomain: string): Promise<Set<string>>;
}

export interface MatchingProductIds {
  execute(shopDomain: string, filter: CatalogFilter): Promise<string[]>;
}

export interface ProductRestoreQueue {
  executeMany(inputs: EnqueueJobInput[]): Promise<unknown>;
}

export interface QueuedProductRestores {
  queuedCount: number;
  /** Sản phẩm được chọn nhưng không có ảnh watermark nào của app để gỡ. */
  skippedCount: number;
}

/**
 * Khôi phục ảnh gốc cho nhiều sản phẩm. Mỗi sản phẩm tốn vài lượt gọi Shopify
 * nên chạy nền qua queue (từng sản phẩm một job, lỗi thì thử lại riêng), thay
 * vì giữ request HTTP tới khi xong.
 */
export class QueueProductRestores {
  constructor(
    private readonly restorable: RestorableProductReader,
    private readonly matching: MatchingProductIds,
    private readonly queue: ProductRestoreQueue,
  ) {}

  async execute(shopDomain: string, selection: RestoreSelection): Promise<QueuedProductRestores> {
    if (!shopDomain.trim()) throw new Error("Shop domain không được để trống");

    const selected =
      selection.kind === "FILTER"
        ? await this.matching.execute(shopDomain, selection.filter)
        : [...new Set(selection.productIds)];
    if (selection.kind === "PRODUCT_IDS" && selected.length > MAX_SELECTED_RESTORE) {
      throw new Error(
        `Chọn tay tối đa ${MAX_SELECTED_RESTORE.toLocaleString("vi-VN")} sản phẩm; nhiều hơn thì dùng "Chọn tất cả khớp bộ lọc"`,
      );
    }
    if (selected.length === 0) throw new Error("Chưa chọn sản phẩm nào");

    const restorable = await this.restorable.listRestorableProductIds(shopDomain);
    const targets = selected.filter((productId) => restorable.has(productId));
    await this.enqueue(shopDomain, targets);
    return { queuedCount: targets.length, skippedCount: selected.length - targets.length };
  }

  /** "Khôi phục tất cả sản phẩm": mọi sản phẩm đang có ảnh watermark của app. */
  async executeAll(shopDomain: string): Promise<QueuedProductRestores> {
    if (!shopDomain.trim()) throw new Error("Shop domain không được để trống");
    const targets = [...(await this.restorable.listRestorableProductIds(shopDomain))];
    await this.enqueue(shopDomain, targets);
    return { queuedCount: targets.length, skippedCount: 0 };
  }

  private async enqueue(shopDomain: string, productIds: string[]): Promise<void> {
    if (productIds.length === 0) return;
    await this.queue.executeMany(productIds.map((productId) => restoreProductJob(productId, shopDomain)));
  }
}

/**
 * jobId cố định theo sản phẩm: bấm lại khi sản phẩm còn chờ trong queue thì
 * BullMQ bỏ qua bản trùng; replaceFinished cho phép khôi phục lại lần sau.
 * GID chứa ":" mà BullMQ không cho dùng trong jobId nên băm lại.
 */
export function restoreProductJob(productId: string, shopDomain: string): EnqueueJobInput {
  const key = createHash("sha1").update(`${shopDomain}|${productId}`).digest("hex");
  return {
    ...PUBLICATION_RESTORE_PRODUCT_V1,
    jobId: `restore-product_${key}`,
    payload: { productId, shopDomain },
    maxAttempts: 3,
    replaceFinished: true,
  };
}
