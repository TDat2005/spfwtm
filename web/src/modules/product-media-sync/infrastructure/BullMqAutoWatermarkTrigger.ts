import { createHash } from "node:crypto";
import type { EnqueueJob } from "../../jobs/application/EnqueueJob.ts";
import { AUTO_WATERMARK_EVALUATE_V1 } from "../../jobs/domain/JobDefinitions.ts";
import type { AutoWatermarkTrigger } from "../application/ReconcileProductMedia.ts";

export class BullMqAutoWatermarkTrigger implements AutoWatermarkTrigger {
  constructor(private readonly enqueueJob: EnqueueJob) {}

  async request(input: {
    shopDomain: string;
    productId: string;
    trigger: "NEW_PRODUCT" | "PRIMARY_CHANGED";
  }): Promise<void> {
    const key = createHash("sha256")
      .update(`${input.shopDomain}\0${input.productId}\0${input.trigger}`)
      .digest("hex")
      .slice(0, 32);
    await this.enqueueJob.execute({
      ...AUTO_WATERMARK_EVALUATE_V1,
      // Cùng sản phẩm, cùng trigger đang chờ thì không xếp thêm: job đọc trạng thái mới nhất.
      jobId: `autowm-eval-${key}`,
      payload: input,
      maxAttempts: 5,
      removeOnComplete: true,
    });
  }
}
