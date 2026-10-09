import { describe, expect, it } from "vitest";
import { batchPublishJob } from "./BatchPublishJob.ts";

describe("batchPublishJob", () => {
  it("gỡ ảnh watermark cũ, không đè ảnh mới hơn và cho phép thử lại lần publish lỗi", () => {
    expect(batchPublishJob("job-1", "a.myshopify.com")).toMatchObject({
      jobName: "PUBLICATION_PUBLISH_V1",
      jobId: "publish_job-1",
      payload: {
        watermarkJobId: "job-1",
        shopDomain: "a.myshopify.com",
        replacePrevious: true,
        onlyIfNewest: true,
      },
      maxAttempts: 5,
      replaceFinished: true,
    });
  });
});
