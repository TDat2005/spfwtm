import type { JobQueue } from "./JobQueue.ts";

export type JobHandler = (
  payload: Record<string, unknown>
) => Promise<void>;

export class RunPendingJobs {
  private readonly handlers = new Map<string, JobHandler>();

  constructor(private readonly queue: JobQueue) {}

  registerHandler(jobType: string, handler: JobHandler): void {
    this.handlers.set(jobType, handler);
  }

  async executeNext(): Promise<boolean> {
    const jobTypes = Array.from(this.handlers.keys());
    if (jobTypes.length === 0) return false;

    const job = await this.queue.acquireNext(jobTypes);
    if (!job) return false;

    const handler = this.handlers.get(job.jobName);
    if (!handler) {
      job.fail(`Không tìm thấy handler cho jobType ${job.jobName}`);
      await this.queue.save(job);
      return true;
    }

    try {
      await handler(job.payload);
      job.complete();
      await this.queue.save(job);
      return true;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Xử lý job thất bại";
      job.fail(message);

      if (job.canRetry()) {
        job.retry();
      }

      await this.queue.save(job);
      return true;
    }
  }
}
