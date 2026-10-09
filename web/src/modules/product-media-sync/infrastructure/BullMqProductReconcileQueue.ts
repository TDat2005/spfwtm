import type { EnqueueJob } from "../../jobs/application/EnqueueJob.ts";
import type { JobInspector } from "../../jobs/application/JobQueue.ts";
import { PRODUCT_MEDIA_RECONCILE_V1 } from "../../jobs/domain/JobDefinitions.ts";
import type { ProductReconcileQueue } from "../application/ReceiveProductWebhook.ts";
import type { ReconcileJobInspector } from "../application/RecoverMediaSync.ts";

export class BullMqProductReconcileQueue implements ProductReconcileQueue, ReconcileJobInspector {
  constructor(
    private readonly enqueueJob: EnqueueJob,
    private readonly inspector: JobInspector,
  ) {}

  async enqueue(input: {
    webhookId: string;
    shopDomain: string;
    productId: string;
    delayMs: number;
  }): Promise<void> {
    await this.enqueueJob.execute({
      ...PRODUCT_MEDIA_RECONCILE_V1,
      jobId: reconcileJobId(input.shopDomain, input.productId),
      // Mỗi sản phẩm một jobId (gộp webhook dồn dập). Lần reconcile trước thất bại
      // hết lượt thì BullMQ giữ bản ghi 7 ngày và bỏ qua mọi job mới cùng id, tức
      // sản phẩm không được đồng bộ nữa. Xóa bản ghi đó trước khi đưa job mới.
      replaceFinished: true,
      payload: {
        webhookId: input.webhookId,
        shopDomain: input.shopDomain,
      },
      delayMs: input.delayMs,
      maxAttempts: 5,
      removeOnComplete: true,
    });
  }

  async isQueued(shopDomain: string, productId: string): Promise<boolean> {
    const jobId = reconcileJobId(shopDomain, productId);
    const live = await this.inspector.findLiveJobIds([jobId], [PRODUCT_MEDIA_RECONCILE_V1.lane]);
    return live.has(jobId);
  }
}

function reconcileJobId(shopDomain: string, productId: string): string {
  return `reconcile_${shopDomain}_${productId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}
