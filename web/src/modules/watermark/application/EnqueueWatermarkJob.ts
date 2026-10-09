import type {
  WatermarkEnqueueRepository,
  WatermarkQueue,
} from "./WatermarkQueuePorts.ts";

export interface EnqueueWatermarkJobInput {
  jobId: string;
  shopDomain: string;
  priority: number;
}

/**
 * Đưa một job lẻ (tạo tay, retry, auto-rule cho một sản phẩm) vào lane
 * interactive. `enqueuedAt` được ghi trước, nên nếu job không tới được queue
 * thì RecoverWatermarkJobs sẽ phát hiện và đưa lại.
 */
export class EnqueueWatermarkJob {
  constructor(
    private readonly repository: WatermarkEnqueueRepository,
    private readonly queue: WatermarkQueue,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: EnqueueWatermarkJobInput): Promise<void> {
    const marked = await this.repository.markEnqueued(input.jobId, this.now());
    if (!marked) return;

    await this.queue.enqueue(
      [{ id: input.jobId, shopDomain: input.shopDomain, batchId: marked.batchId }],
      "interactive",
      input.priority,
      // Job retry còn bản ghi thất bại cũ trong queue, phải xóa thì mới đưa lại được.
      { replaceFinished: true },
    );
  }
}
