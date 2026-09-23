import { randomUUID } from "node:crypto";
import { BackgroundJob } from "../domain/BackgroundJob.ts";
import type { JobPublisher } from "./JobQueue.ts";

export interface EnqueueJobInput {
  jobType: string;
  payload: Record<string, unknown>;
  maxAttempts?: number;
}

export class EnqueueJob {
  constructor(private readonly queue: JobPublisher) {}

  async execute(input: EnqueueJobInput): Promise<BackgroundJob> {
    const job = new BackgroundJob({
      id: randomUUID(),
      jobType: input.jobType,
      payload: input.payload,
      maxAttempts: input.maxAttempts ?? 3,
    });

    await this.queue.enqueue(job);
    return job;
  }
}
