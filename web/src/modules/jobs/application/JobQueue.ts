import type { BackgroundJob } from "../domain/BackgroundJob.ts";

export interface JobPublisher {
  enqueue(job: BackgroundJob): Promise<void>;
  enqueueMany(jobs: BackgroundJob[]): Promise<void>;
}
