import { randomUUID } from "node:crypto";
import { BackgroundJob } from "../domain/BackgroundJob.ts";
import type { JobPublisher } from "./JobQueue.ts";

export interface EnqueueJobInput {
  jobName: string;
  payload: Record<string, unknown>;
  payloadVersion: number;
  processorVersion: number;
  delayMs?: number;
  maxAttempts?: number;
}

export class EnqueueJob {
  constructor(private readonly queue: JobPublisher) {}

  async execute(input: EnqueueJobInput): Promise<BackgroundJob> {
    const job = new BackgroundJob({
      id: randomUUID(),
      jobName: input.jobName,
      payload: input.payload,
      payloadVersion: input.payloadVersion,
      processorVersion: input.processorVersion,
      delayMs: input.delayMs,
      maxAttempts: input.maxAttempts ?? 3,
    });

    await this.queue.enqueue(job);
    return job;
  }
}
