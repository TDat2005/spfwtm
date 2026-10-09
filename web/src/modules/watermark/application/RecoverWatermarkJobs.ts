import { JOB_PRIORITY } from "../../jobs/domain/JobDefinitions.ts";
import { batchSizeOf } from "./DispatchWatermarkBatch.ts";
import type {
  QueuedJobRecord,
  WatermarkLane,
  WatermarkQueue,
  WatermarkRecoveryRepository,
} from "./WatermarkQueuePorts.ts";

/** Job PENDING đã vào queue quá chừng này thì đối chiếu lại với queue. */
export const QUEUED_CHECK_AFTER_MS = 5 * 60 * 1000;
/** Job PROCESSING không đổi gì quá chừng này thì đối chiếu lại với queue. */
export const PROCESSING_CHECK_AFTER_MS = 5 * 60 * 1000;

export const ABANDONED_JOB_MESSAGE =
  "Worker dừng đột ngột khi đang xử lý ảnh này (ảnh có thể quá lớn hoặc bị hỏng). Hãy thử lại.";

export interface RecoveryResult {
  requeuedJobs: number;
  failedJobs: number;
}

/**
 * Đối chiếu trạng thái job trong DB với queue, chạy định kỳ cùng sweep.
 *
 * - PENDING đã vào queue mà queue không còn job (Redis mất dữ liệu, bản ghi
 *   thất bại cũ chặn job, ...): đưa lại vào queue.
 * - PROCESSING mà queue không còn job: worker chết giữa chừng nhiều lần nên
 *   BullMQ đã đánh job thất bại ("stalled more than allowable limit") mà không
 *   gọi handler. Không ai còn chuyển job sang FAILED, nên nó giữ mãi một chỗ
 *   trong cửa sổ của shop. Đánh FAILED để merchant thấy lỗi và sweep bù chỗ.
 *
 * Job còn trong queue (đang chờ, chờ retry, đang chạy) không bị đụng tới.
 */
export class RecoverWatermarkJobs {
  constructor(
    private readonly repository: WatermarkRecoveryRepository,
    private readonly queue: WatermarkQueue,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(limit = 200): Promise<RecoveryResult> {
    const now = this.now();
    return {
      requeuedJobs: await this.requeueLost(now, limit),
      failedJobs: await this.failAbandoned(now, limit),
    };
  }

  private async requeueLost(now: Date, limit: number): Promise<number> {
    const queued = await this.repository.listQueuedBefore(
      new Date(now.getTime() - QUEUED_CHECK_AFTER_MS),
      limit,
    );
    if (queued.length === 0) return 0;

    const alive = await this.queue.findAlive(queued.map((job) => job.id));
    const lost: QueuedJobRecord[] = [];
    for (const job of queued) {
      // Job còn trong queue cũng được ghi lại thời điểm xác nhận, để lượt sau
      // kiểm tra những job khác trước thay vì lặp lại đúng nhóm cũ nhất.
      const unchanged = await this.repository.touchQueued(job.id, job.enqueuedAt, now);
      if (unchanged && !alive.has(job.id)) lost.push(job);
    }

    for (const [lane, jobs] of groupByLane(lost)) {
      await this.queue.enqueue(
        jobs.map((job) => ({ id: job.id, shopDomain: job.shopDomain, batchId: job.batchId })),
        lane,
        lane === "bulk" ? JOB_PRIORITY.NORMAL : JOB_PRIORITY.HIGH,
        { replaceFinished: true },
      );
    }
    return lost.length;
  }

  private async failAbandoned(now: Date, limit: number): Promise<number> {
    const processing = await this.repository.listProcessingBefore(
      new Date(now.getTime() - PROCESSING_CHECK_AFTER_MS),
      limit,
    );
    if (processing.length === 0) return 0;

    const alive = await this.queue.findAlive(processing.map((job) => job.id));
    let failed = 0;
    for (const job of processing) {
      if (alive.has(job.id)) continue;
      if (await this.repository.failProcessing(job.id, job.updatedAt, ABANDONED_JOB_MESSAGE)) {
        failed += 1;
      }
    }
    return failed;
  }
}

function groupByLane(jobs: QueuedJobRecord[]): Map<WatermarkLane, QueuedJobRecord[]> {
  const byLane = new Map<WatermarkLane, QueuedJobRecord[]>();
  for (const job of jobs) {
    const lane: WatermarkLane =
      job.batchTotalJobs !== null && batchSizeOf(job.batchTotalJobs) === "LARGE"
        ? "bulk"
        : "interactive";
    byLane.set(lane, [...(byLane.get(lane) ?? []), job]);
  }
  return byLane;
}
