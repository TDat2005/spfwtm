import type { EnqueueJob } from "../../jobs/application/EnqueueJob.ts";
import { JOB_PRIORITY, WATERMARK_PROCESS_V1 } from "../../jobs/domain/JobDefinitions.ts";
import type { WatermarkBatchDispatchRepository } from "./BulkWatermarkPorts.ts";

/** Batch tới ngưỡng này đi lane interactive và vào queue một lần. */
export const INTERACTIVE_BATCH_LIMIT = 50;
/** Số job tối đa của một batch lớn được nằm trong lane bulk cùng lúc. */
export const BULK_WINDOW_SIZE = 25;
/** Job đã vào queue quá lâu mà vẫn PENDING thì coi như có thể đã mất và đưa lại. */
export const STALE_ENQUEUE_MS = 30 * 60 * 1000;

/**
 * Nhỏ giọt job của batch vào BullMQ.
 *
 * Batch nhỏ vào lane interactive ngay. Batch lớn chỉ giữ tối đa BULK_WINDOW_SIZE
 * job trong lane bulk; mỗi job xong lại gọi dispatcher để bù chỗ. Vì mỗi batch
 * chỉ chiếm một cửa sổ nhỏ, các batch của nhiều shop chạy xen kẽ nhau thay vì
 * batch đến sau phải chờ batch trước chạy hết.
 *
 * BullMQ jobId = `wm_<watermarkJobId>`, nên hai dispatcher chạy song song hoặc
 * việc đưa lại job "stale" không tạo ra job trùng.
 */
export class DispatchWatermarkBatch {
  constructor(
    private readonly repository: WatermarkBatchDispatchRepository,
    private readonly enqueueJob: EnqueueJob,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(batchId: string): Promise<number> {
    const staleBefore = new Date(this.now().getTime() - STALE_ENQUEUE_MS);
    const state = await this.repository.getDispatchState(batchId, staleBefore);
    if (!state) return 0;

    const interactive = state.totalJobs <= INTERACTIVE_BATCH_LIMIT;
    const window = interactive ? state.totalJobs : BULK_WINDOW_SIZE;
    const free = window - state.inFlightJobs;
    if (free <= 0) return 0;

    const jobs = await this.repository.claimJobs(batchId, free, staleBefore);
    if (jobs.length === 0) return 0;

    try {
      await this.enqueueJob.executeMany(
        jobs.map((job) => ({
          ...WATERMARK_PROCESS_V1,
          jobId: `wm_${job.id}`,
          lane: interactive ? "interactive" : "bulk",
          priority: interactive ? JOB_PRIORITY.HIGH : JOB_PRIORITY.NORMAL,
          payload: {
            jobId: job.id,
            shopDomain: state.shopDomain,
            batchId,
          },
        })),
      );
    } catch (error) {
      await this.repository.releaseJobs(jobs.map((job) => job.id));
      throw error;
    }
    return jobs.length;
  }

  /** Lưới an toàn chạy định kỳ: bù cho batch bị kẹt (worker chết, Redis lỗi...). */
  async sweep(limit = 100): Promise<number> {
    const staleBefore = new Date(this.now().getTime() - STALE_ENQUEUE_MS);
    const batchIds = await this.repository.listBatchesNeedingDispatch(staleBefore, limit);
    let dispatched = 0;
    for (const batchId of batchIds) {
      dispatched += await this.execute(batchId);
    }
    return dispatched;
  }
}
