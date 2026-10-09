export type WatermarkLane = "interactive" | "bulk";

export interface QueuedWatermarkJob {
  id: string;
  shopDomain: string;
  /** Job của batch: xong thì gọi dispatcher bù chỗ trong cửa sổ của shop. */
  batchId: string | null;
}

/**
 * Queue xử lý job watermark. Mỗi job watermark có đúng một id trong queue, nên
 * đưa lại một job còn đang chờ hoặc đang chạy không tạo ra job thứ hai.
 */
export interface WatermarkQueue {
  enqueue(
    jobs: QueuedWatermarkJob[],
    lane: WatermarkLane,
    priority: number,
    /** Xóa bản ghi cũ đã xong/thất bại của job trước khi đưa lại (retry, khôi phục). */
    options?: { replaceFinished?: boolean },
  ): Promise<void>;
  /** Id của những job còn đang chờ, chờ retry hoặc đang chạy trong queue. */
  findAlive(jobIds: string[]): Promise<Set<string>>;
}

export interface WatermarkEnqueueRepository {
  /**
   * Ghi thời điểm job PENDING được đưa vào queue. Trả về batch của job, hoặc
   * null nếu job không còn PENDING (đã hủy, đã xong).
   */
  markEnqueued(jobId: string, at: Date): Promise<{ batchId: string | null } | null>;
}

export interface QueuedJobRecord {
  id: string;
  shopDomain: string;
  batchId: string | null;
  /** Số job của batch (null = job lẻ), quyết định lane khi đưa lại. */
  batchTotalJobs: number | null;
  enqueuedAt: Date;
}

export interface ProcessingJobRecord {
  id: string;
  updatedAt: Date;
}

export interface WatermarkRecoveryRepository {
  /** Job PENDING vào queue (hoặc được xác nhận còn trong queue) trước `before`, cũ nhất trước. */
  listQueuedBefore(before: Date, limit: number): Promise<QueuedJobRecord[]>;
  /** Ghi lại enqueuedAt nếu job vẫn PENDING với đúng enqueuedAt đã đọc; false = job đã đổi. */
  touchQueued(jobId: string, seenEnqueuedAt: Date, at: Date): Promise<boolean>;
  /** Job PROCESSING không đổi gì từ trước `before`, cũ nhất trước. */
  listProcessingBefore(before: Date, limit: number): Promise<ProcessingJobRecord[]>;
  /**
   * PROCESSING → FAILED (cùng transition với WatermarkJob.fail) nếu job chưa
   * đổi kể từ lúc đọc (updatedAt khớp); false = job đã đổi.
   */
  failProcessing(jobId: string, seenUpdatedAt: Date, message: string): Promise<boolean>;
}
