import type { BackgroundJob } from "../domain/BackgroundJob.ts";
import type { JobLane } from "../domain/JobDefinitions.ts";

export interface JobPublisher {
  enqueue(job: BackgroundJob): Promise<void>;
  enqueueMany(jobs: BackgroundJob[]): Promise<void>;
}

/** Tra cứu job trong queue theo jobId, để đối chiếu trạng thái trong DB với queue. */
export interface JobInspector {
  /** Những jobId còn đang chờ, chờ retry hoặc đang chạy ở một trong các lane. */
  findLiveJobIds(jobIds: string[], lanes: readonly JobLane[]): Promise<Set<string>>;
  /**
   * Xóa bản ghi đã hoàn thành/thất bại của các jobId. BullMQ bỏ qua job mới
   * trùng jobId với bản ghi cũ còn được giữ lại, nên phải xóa trước khi đưa lại.
   */
  removeFinishedJobs(jobIds: string[], lanes: readonly JobLane[]): Promise<void>;
}
