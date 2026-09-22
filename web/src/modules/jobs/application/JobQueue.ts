import type { BackgroundJob } from "../domain/BackgroundJob.ts";

export interface JobQueue {
  enqueue(job: BackgroundJob): Promise<void>;
  acquireNext(jobTypes: string[]): Promise<BackgroundJob | null>;
  save(job: BackgroundJob): Promise<void>;
  findById(id: string): Promise<BackgroundJob | null>;
}
