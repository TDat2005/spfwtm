/**
 * Mỗi lane là một queue BullMQ riêng với worker và concurrency riêng:
 * - interactive: việc merchant đang chờ kết quả (job lẻ, batch nhỏ, auto-rule 1 sản phẩm).
 * - bulk: batch lớn, được DispatchWatermarkBatch nhỏ giọt vào queue theo cửa sổ của từng shop.
 * - system: webhook reconcile, catalog sync, publish và các job định kỳ.
 */
export const JOB_LANES = ["interactive", "bulk", "system"] as const;
export type JobLane = (typeof JOB_LANES)[number];

/**
 * BullMQ: số nhỏ được ưu tiên hơn, và job KHÔNG có priority chạy trước mọi
 * job có priority. Vì vậy mọi job đều phải mang priority tường minh.
 */
export const JOB_PRIORITY = {
  URGENT: 1,
  HIGH: 2,
  NORMAL: 5,
  LOW: 10,
} as const;

export type JobDefinition = {
  jobName: string;
  payloadVersion: number;
  processorVersion: number;
  lane: JobLane;
  priority: number;
};

export const WATERMARK_PROCESS_V1 = {
  jobName: "WATERMARK_PROCESS_V1",
  payloadVersion: 1,
  processorVersion: 1,
  lane: "interactive",
  priority: JOB_PRIORITY.URGENT,
} as const satisfies JobDefinition;

/** Job định kỳ: đối chiếu job watermark với queue (RecoverWatermarkJobs) rồi bù chỗ cho batch bị kẹt. */
export const WATERMARK_BATCH_DISPATCH_V1 = {
  jobName: "WATERMARK_BATCH_DISPATCH_V1",
  payloadVersion: 1,
  processorVersion: 1,
  lane: "system",
  priority: JOB_PRIORITY.LOW,
} as const satisfies JobDefinition;

/** Xét rule cho một sản phẩm sau webhook (sản phẩm mới / đổi ảnh chính). */
export const AUTO_WATERMARK_EVALUATE_V1 = {
  jobName: "AUTO_WATERMARK_EVALUATE_V1",
  payloadVersion: 1,
  processorVersion: 1,
  lane: "system",
  priority: JOB_PRIORITY.HIGH,
} as const satisfies JobDefinition;

/** Áp rule cho sản phẩm trong phạm vi của một shop (đồng bộ hoặc bấm tay). */
export const AUTO_WATERMARK_APPLY_V1 = {
  jobName: "AUTO_WATERMARK_APPLY_V1",
  payloadVersion: 1,
  processorVersion: 1,
  lane: "system",
  priority: JOB_PRIORITY.LOW,
} as const satisfies JobDefinition;

/** Job hằng đêm: tạo AUTO_WATERMARK_APPLY_V1 cho từng shop có rule đồng bộ. */
export const AUTO_WATERMARK_SYNC_V1 = {
  jobName: "AUTO_WATERMARK_SYNC_V1",
  payloadVersion: 1,
  processorVersion: 1,
  lane: "system",
  priority: JOB_PRIORITY.LOW,
} as const satisfies JobDefinition;

export const PUBLICATION_PUBLISH_V1 = {
  jobName: "PUBLICATION_PUBLISH_V1",
  payloadVersion: 1,
  processorVersion: 1,
  lane: "system",
  priority: JOB_PRIORITY.NORMAL,
} as const satisfies JobDefinition;

/** Gỡ một ảnh watermark đã publish khỏi Shopify (rule bật restoreOnLeave). */
export const PUBLICATION_RESTORE_V1 = {
  jobName: "PUBLICATION_RESTORE_V1",
  payloadVersion: 1,
  processorVersion: 1,
  lane: "system",
  priority: JOB_PRIORITY.NORMAL,
} as const satisfies JobDefinition;

/** Khôi phục ảnh gốc của một sản phẩm: gỡ mọi ảnh watermark của app (merchant chọn nhiều sản phẩm). */
export const PUBLICATION_RESTORE_PRODUCT_V1 = {
  jobName: "PUBLICATION_RESTORE_PRODUCT_V1",
  payloadVersion: 1,
  processorVersion: 1,
  lane: "system",
  priority: JOB_PRIORITY.NORMAL,
} as const satisfies JobDefinition;

export const PRODUCT_MEDIA_RECONCILE_V1 = {
  jobName: "PRODUCT_MEDIA_RECONCILE_V1",
  payloadVersion: 1,
  processorVersion: 1,
  lane: "system",
  priority: JOB_PRIORITY.URGENT,
} as const satisfies JobDefinition;

/** Job định kỳ: đưa lại webhook sản phẩm bị kẹt, đánh FAILED lượt publish bị bỏ dở (RecoverMediaSync). */
export const MEDIA_SYNC_RECOVER_V1 = {
  jobName: "MEDIA_SYNC_RECOVER_V1",
  payloadVersion: 1,
  processorVersion: 1,
  lane: "system",
  priority: JOB_PRIORITY.LOW,
} as const satisfies JobDefinition;

export const CATALOG_RECONCILE_V1 = {
  jobName: "CATALOG_RECONCILE_V1",
  payloadVersion: 1,
  processorVersion: 1,
  lane: "system",
  priority: JOB_PRIORITY.LOW,
} as const satisfies JobDefinition;

export const CATALOG_SYNC_PAGE_V1 = {
  jobName: "CATALOG_SYNC_PAGE_V1",
  payloadVersion: 1,
  processorVersion: 1,
  lane: "system",
  priority: JOB_PRIORITY.NORMAL,
} as const satisfies JobDefinition;

export function assertJobVersion(
  payload: Record<string, unknown>,
  definition: Pick<JobDefinition, "jobName" | "payloadVersion" | "processorVersion">
): void {
  if (payload.payloadVersion !== definition.payloadVersion) {
    throw new Error(
      `${definition.jobName}: payloadVersion không được hỗ trợ (${String(payload.payloadVersion)})`
    );
  }
  if (payload.processorVersion !== definition.processorVersion) {
    throw new Error(
      `${definition.jobName}: processorVersion không được hỗ trợ (${String(payload.processorVersion)})`
    );
  }
}
