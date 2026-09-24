import type { EnqueueJob } from "../../jobs/application/EnqueueJob.ts";
import { PRODUCT_MEDIA_RECONCILE_V1 } from "../../jobs/domain/JobDefinitions.ts";
import type { ProductReconcileQueue } from "../application/ReceiveProductWebhook.ts";

export class BullMqProductReconcileQueue implements ProductReconcileQueue {
  constructor(private readonly enqueueJob: EnqueueJob) {}

  async enqueue(input: {
    webhookId: string;
    shopDomain: string;
    delayMs: number;
  }): Promise<void> {
    await this.enqueueJob.execute({
      ...PRODUCT_MEDIA_RECONCILE_V1,
      payload: {
        webhookId: input.webhookId,
        shopDomain: input.shopDomain,
      },
      delayMs: input.delayMs,
      maxAttempts: 5,
    });
  }
}
