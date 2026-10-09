import type { ProductReconcileQueue } from "./ReceiveProductWebhook.ts";

/** Webhook chưa xử lý xong mà không đổi gì quá chừng này thì coi là bị kẹt. */
export const STALE_INBOX_AFTER_MS = 10 * 60 * 1000;
/**
 * Lượt publish thật chỉ mất vài giây đến một phút (job publish bị canh 10 phút),
 * nên PUBLISHING quá 30 phút chắc chắn là của tiến trình đã chết.
 */
export const STALE_PUBLICATION_AFTER_MS = 30 * 60 * 1000;

export interface StalledInboxProduct {
  shopDomain: string;
  productId: string;
  /** Webhook mới nhất còn dở của sản phẩm: job reconcile nhận từ webhook này. */
  webhookId: string;
}

export interface WebhookInboxRecoveryRepository {
  /** Sản phẩm có webhook RECEIVED/ENQUEUED/PROCESSING không đổi gì từ trước `before`. */
  listStalledProducts(before: Date, limit: number): Promise<StalledInboxProduct[]>;
  /** Đưa webhook PROCESSING bị kẹt của sản phẩm về ENQUEUED để job reconcile nhận lại được. */
  releaseStalled(shopDomain: string, productId: string, before: Date): Promise<void>;
}

export interface StalePublicationAttempts {
  /** PUBLISHING tạo trước `before` → FAILED. Trả về số lượt đã đổi. */
  failStale(before: Date): Promise<number>;
}

export interface ReconcileJobInspector {
  /** Job reconcile của sản phẩm còn đang chờ hoặc đang chạy trong queue. */
  isQueued(shopDomain: string, productId: string): Promise<boolean>;
}

export interface MediaSyncRecoveryResult {
  requeuedProducts: number;
  failedPublications: number;
}

/**
 * Lưới an toàn chạy định kỳ cho đồng bộ ảnh sản phẩm:
 *
 * - Webhook kẹt: tiến trình chết khi đang xử lý (dòng đứng PROCESSING), job
 *   reconcile đã thất bại hết lượt (ví dụ chờ publish quá lâu), hoặc webhook đến
 *   trong lúc job đang chạy. Không job nào còn trong queue thì đưa lại.
 * - Lượt publish đứng PUBLISHING vì tiến trình chết giữa chừng: đánh FAILED.
 */
export class RecoverMediaSync {
  constructor(
    private readonly inbox: WebhookInboxRecoveryRepository,
    private readonly publications: StalePublicationAttempts,
    private readonly queue: ProductReconcileQueue & ReconcileJobInspector,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(limit = 200): Promise<MediaSyncRecoveryResult> {
    const now = this.now().getTime();
    const staleBefore = new Date(now - STALE_INBOX_AFTER_MS);

    let requeuedProducts = 0;
    for (const item of await this.inbox.listStalledProducts(staleBefore, limit)) {
      if (await this.queue.isQueued(item.shopDomain, item.productId)) continue;
      await this.inbox.releaseStalled(item.shopDomain, item.productId, staleBefore);
      await this.queue.enqueue({
        webhookId: item.webhookId,
        shopDomain: item.shopDomain,
        productId: item.productId,
        delayMs: 0,
      });
      requeuedProducts += 1;
    }

    const failedPublications = await this.publications.failStale(
      new Date(now - STALE_PUBLICATION_AFTER_MS),
    );
    return { requeuedProducts, failedPublications };
  }
}
