import { Queue, type ConnectionOptions } from "bullmq";
import type { JobPublisher } from "../application/JobQueue.ts";
import type { BackgroundJob } from "../domain/BackgroundJob.ts";
import type { JobDefinition } from "../domain/JobDefinitions.ts";

interface BullMqJobQueueOptions {
  queueName: string;
  connection: ConnectionOptions;
  prefix?: string;
}

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
    const entry = toBullMqEntry(job);
    await this.queue.add(entry.name, entry.data, entry.opts);
  }

  async enqueueMany(jobs: BackgroundJob[]): Promise<void> {
    if (jobs.length === 0) return;
    await this.queue.addBulk(jobs.map(toBullMqEntry));
  }

  async close(): Promise<void> {
    await this.queue.close();
  }

  async upsertDailyJob(
    definition: JobDefinition,
    pattern: string,
    timezone: string
  ): Promise<void> {
    await this.queue.upsertJobScheduler(
      definition.jobName,
      { pattern, tz: timezone },
      {
        name: definition.jobName,
        data: {
          payloadVersion: definition.payloadVersion,
          processorVersion: definition.processorVersion,
        },
        opts: {
          attempts: 3,
          backoff: { type: "exponential", delay: 5_000 },
          removeOnComplete: { age: 7 * 24 * 60 * 60, count: 30 },
          removeOnFail: { age: 30 * 24 * 60 * 60, count: 100 },
        },
      }
    );
  }
}

function toBullMqEntry(job: BackgroundJob) {
  return {
    name: job.jobName,
    data: {
      ...job.payload,
      payloadVersion: job.payloadVersion,
      processorVersion: job.processorVersion,
    },
    opts: {
      jobId: job.id,
      delay: job.delayMs,
      attempts: job.maxAttempts,
      backoff: {
        type: "exponential" as const,
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
    },
  };
}
