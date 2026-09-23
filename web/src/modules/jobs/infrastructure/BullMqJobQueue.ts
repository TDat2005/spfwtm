import { Queue, type ConnectionOptions } from "bullmq";
import type { JobPublisher } from "../application/JobQueue.ts";
import type { BackgroundJob } from "../domain/BackgroundJob.ts";

interface BullMqJobQueueOptions {
  queueName: string;
  connection: ConnectionOptions;
  prefix?: string;
}

/** Producer adapter: chuyển BackgroundJob của application thành BullMQ job. */
export class BullMqJobQueue implements JobPublisher {
  private readonly queue: Queue<Record<string, unknown>>;

  constructor(options: BullMqJobQueueOptions) {
    this.queue = new Queue(options.queueName, {
      connection: options.connection,
      prefix: options.prefix,
    });
    this.queue.on("error", (error) => {
      console.error("[BullMQ] Lỗi kết nối producer:", error.message);
    });
  }

  async enqueue(job: BackgroundJob): Promise<void> {
    await this.queue.add(job.jobType, job.payload, {
      jobId: job.id,
      attempts: job.maxAttempts,
      backoff: {
        type: "exponential",
        delay: 1_000,
      },
      removeOnComplete: {
        age: 60 * 60,
        count: 1_000,
      },
      removeOnFail: {
        age: 7 * 24 * 60 * 60,
        count: 5_000,
      },
    });
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
