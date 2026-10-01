import type { BackgroundJob } from "../domain/BackgroundJob.ts";

export interface JobPublisher {
  enqueue(job: BackgroundJob): Promise<void>;
  enqueueMany(jobs: BackgroundJob[]): Promise<void>;
}

export interface JobQueue extends JobPublisher {
  acquireNext(jobTypes: string[]): Promise<BackgroundJob | null>;
  save(job: BackgroundJob): Promise<void>;
  findById(id: string): Promise<BackgroundJob | null>;
}
