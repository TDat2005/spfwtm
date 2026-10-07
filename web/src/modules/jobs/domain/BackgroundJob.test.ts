import { describe, expect, it } from "vitest";
import { BackgroundJob } from "./BackgroundJob.ts";
import { WATERMARK_PROCESS_V1 } from "./JobDefinitions.ts";

describe("versioned background jobs", () => {
  it("đóng băng job name, payload version và processor version", () => {
    const job = new BackgroundJob({
      id: "job-1",
      ...WATERMARK_PROCESS_V1,
      payload: { jobId: "watermark-1" },
    });

    expect(job.jobName).toBe("WATERMARK_PROCESS_V1");
    expect(job.payloadVersion).toBe(1);
    expect(job.processorVersion).toBe(1);
    expect(job.lane).toBe("interactive");
    expect(job.priority).toBe(1);
  });

  it("từ chối priority 0 vì BullMQ sẽ cho job đó chạy trước mọi job khác", () => {
    expect(
      () =>
        new BackgroundJob({
          id: "job-1",
          ...WATERMARK_PROCESS_V1,
          priority: 0,
          payload: {},
        })
    ).toThrow("Priority phải là số nguyên");
  });
});
