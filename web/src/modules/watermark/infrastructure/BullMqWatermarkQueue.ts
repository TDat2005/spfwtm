import type { EnqueueJob } from "../../jobs/application/EnqueueJob.ts";
import type { JobInspector } from "../../jobs/application/JobQueue.ts";
import { WATERMARK_PROCESS_V1 } from "../../jobs/domain/JobDefinitions.ts";
import type {
  QueuedWatermarkJob,
  WatermarkLane,
  WatermarkQueue,
} from "../application/WatermarkQueuePorts.ts";

/** Các lane có thể chứa job watermark. */
const WATERMARK_LANES = ["interactive", "bulk"] as const;

export class BullMqWatermarkQueue implements WatermarkQueue {
  constructor(
    private readonly enqueueJob: EnqueueJob,
    private readonly inspector: JobInspector,
  ) {}

  async enqueue(
    jobs: QueuedWatermarkJob[],
    lane: WatermarkLane,
    priority: number,
    options: { replaceFinished?: boolean } = {},
  ): Promise<void> {
    if (jobs.length === 0) return;
    await this.enqueueJob.executeMany(
      jobs.map((job) => ({
        ...WATERMARK_PROCESS_V1,
        jobId: queueJobId(job.id),
        lane,
        priority,
        replaceFinished: options.replaceFinished,
        payload: {
          jobId: job.id,
          shopDomain: job.shopDomain,
          ...(job.batchId ? { batchId: job.batchId } : {}),
        },
      })),
    );
  }

  async findAlive(jobIds: string[]): Promise<Set<string>> {
    if (jobIds.length === 0) return new Set();
    const live = await this.inspector.findLiveJobIds(jobIds.map(queueJobId), WATERMARK_LANES);
    return new Set(jobIds.filter((id) => live.has(queueJobId(id))));
  }
}

/** Mỗi job watermark có đúng một id trong BullMQ: đưa trùng không tạo job thứ hai. */
function queueJobId(watermarkJobId: string): string {
  return `wm_${watermarkJobId}`;
}
