import { JOB_PRIORITY } from "../../jobs/domain/JobDefinitions.ts";
import type { BatchSize, WatermarkBatchDispatchRepository } from "./BulkWatermarkPorts.ts";
import type { WatermarkQueue } from "./WatermarkQueuePorts.ts";

/** Batch tới ngưỡng này là batch nhỏ và đi lane interactive. */
export const INTERACTIVE_BATCH_LIMIT = 50;
/** Số job batch nhỏ tối đa của một shop nằm trong lane interactive cùng lúc. */
export const INTERACTIVE_SHOP_WINDOW = 50;
/** Số job batch lớn tối đa của một shop nằm trong lane bulk cùng lúc. */
export const BULK_SHOP_WINDOW = 25;

const SWEEP_PAGE_SIZE = 100;
const SWEEP_MAX_PAGES = 10;

export function batchSizeOf(totalJobs: number): BatchSize {
  return totalJobs <= INTERACTIVE_BATCH_LIMIT ? "SMALL" : "LARGE";
}

/**
 * Nhỏ giọt job của batch vào BullMQ theo cửa sổ của từng shop.
 *
 * Batch nhỏ đi lane interactive, batch lớn đi lane bulk. Dù tạo bao nhiêu
 * batch, mỗi shop chỉ có tối đa INTERACTIVE_SHOP_WINDOW job batch nhỏ và
 * BULK_SHOP_WINDOW job batch lớn nằm trong queue cùng lúc; batch tạo trước
 * của shop được chạy trước. Mỗi job xong lại gọi dispatcher để bù chỗ, nên
 * shop đến sau chỉ chờ phần cửa sổ của shop khác chứ không chờ cả batch.
 *
 * Job mang id `wm_<watermarkJobId>` trong queue, nên hai dispatcher chạy song
 * song không tạo ra job trùng.
 */
export class DispatchWatermarkBatch {
  constructor(
    private readonly repository: WatermarkBatchDispatchRepository,
    private readonly queue: WatermarkQueue,
  ) {}

  async execute(batchId: string): Promise<number> {
    const state = await this.repository.getDispatchState(batchId);
    if (!state) return 0;

    const small = state.size === "SMALL";
    const window = small ? INTERACTIVE_SHOP_WINDOW : BULK_SHOP_WINDOW;
    const free = window - state.inFlightJobs;
    if (free <= 0) return 0;

    const jobs = await this.repository.claimJobs(state.shopId, state.size, free);
    if (jobs.length === 0) return 0;

    try {
      await this.queue.enqueue(
        jobs.map((job) => ({ id: job.id, shopDomain: state.shopDomain, batchId: job.batchId })),
        small ? "interactive" : "bulk",
        small ? JOB_PRIORITY.HIGH : JOB_PRIORITY.NORMAL,
      );
    } catch (error) {
      await this.repository.releaseJobs(jobs.map((job) => job.id));
      throw error;
    }
    return jobs.length;
  }

  /** Lưới an toàn chạy định kỳ: bù chỗ cho batch bị kẹt (Redis lỗi, job bị đánh thất bại...). */
  async sweep(): Promise<number> {
    let dispatched = 0;
    let afterBatchId: string | null = null;
    for (let page = 0; page < SWEEP_MAX_PAGES; page++) {
      const batchIds = await this.repository.listBatchesNeedingDispatch(
        afterBatchId,
        SWEEP_PAGE_SIZE,
      );
      for (const batchId of batchIds) {
        dispatched += await this.execute(batchId);
      }
      if (batchIds.length < SWEEP_PAGE_SIZE) break;
      afterBatchId = batchIds[batchIds.length - 1] ?? null;
    }
    return dispatched;
  }
}
