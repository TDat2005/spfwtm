import type { BackgroundJob } from "../domain/BackgroundJob.ts";

export interface JobPublisher {
  enqueue(job: BackgroundJob): Promise<void>;
}

/**
 * Contract của queue kiểu pull cũ. Giữ lại để DatabaseJobQueue vẫn dùng được,
 * còn runtime chính publish job qua BullMQ/Redis.
 */
export interface JobQueue extends JobPublisher {
  acquireNext(jobTypes: string[]): Promise<BackgroundJob | null>;
  save(job: BackgroundJob): Promise<void>;
  findById(id: string): Promise<BackgroundJob | null>;
}
