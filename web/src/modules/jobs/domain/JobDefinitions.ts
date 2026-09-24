export const WATERMARK_PROCESS_V1 = {
  jobName: "WATERMARK_PROCESS_V1",
  payloadVersion: 1,
  processorVersion: 1,
} as const;

export const PRODUCT_MEDIA_RECONCILE_V1 = {
  jobName: "PRODUCT_MEDIA_RECONCILE_V1",
  payloadVersion: 1,
  processorVersion: 1,
} as const;

export const CATALOG_RECONCILE_V1 = {
  jobName: "CATALOG_RECONCILE_V1",
  payloadVersion: 1,
  processorVersion: 1,
} as const;

export type JobDefinition = {
  jobName: string;
  payloadVersion: number;
  processorVersion: number;
};

export function assertJobVersion(
  payload: Record<string, unknown>,
  definition: JobDefinition
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
