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
    const job = this.create(input);

    await this.queue.enqueue(job);
    return job;
  }

  async executeMany(inputs: EnqueueJobInput[]): Promise<BackgroundJob[]> {
    const jobs = inputs.map((input) => this.create(input));
    if (jobs.length === 0) return [];
    await this.queue.enqueueMany(jobs);
    return jobs;
  }

  private create(input: EnqueueJobInput): BackgroundJob {
    return new BackgroundJob({
      id: randomUUID(),
      jobName: input.jobName,
      payload: input.payload,
      payloadVersion: input.payloadVersion,
      processorVersion: input.processorVersion,
      delayMs: input.delayMs,
      maxAttempts: input.maxAttempts ?? 3,
    });
  }
}
