import { describe, expect, it, vi } from "vitest";
import type { EnqueueJob } from "../../jobs/application/EnqueueJob.ts";
import type { JobInspector } from "../../jobs/application/JobQueue.ts";
import { BullMqWatermarkQueue } from "./BullMqWatermarkQueue.ts";

function setup() {
  const executeMany = vi.fn(async () => []);
  const inspector: JobInspector = {
    findLiveJobIds: vi.fn(async () => new Set(["wm_job-1"])),
    removeFinishedJobs: vi.fn(async () => undefined),
  };
  const queue = new BullMqWatermarkQueue({ executeMany } as unknown as EnqueueJob, inspector);
  return { queue, executeMany, inspector };
}

describe("BullMqWatermarkQueue", () => {
  it("đưa job với id `wm_<id>` cố định, kèm batchId khi có", async () => {
    const { queue, executeMany } = setup();

    await queue.enqueue(
      [
        { id: "job-1", shopDomain: "a.myshopify.com", batchId: "batch-1" },
        { id: "job-2", shopDomain: "a.myshopify.com", batchId: null },
      ],
      "bulk",
      5,
    );

    expect(executeMany).toHaveBeenCalledWith([
      expect.objectContaining({
        jobName: "WATERMARK_PROCESS_V1",
        jobId: "wm_job-1",
        lane: "bulk",
        priority: 5,
        replaceFinished: undefined,
        payload: { jobId: "job-1", shopDomain: "a.myshopify.com", batchId: "batch-1" },
      }),
      expect.objectContaining({
        jobId: "wm_job-2",
        payload: { jobId: "job-2", shopDomain: "a.myshopify.com" },
      }),
    ]);
  });

  it("yêu cầu xóa bản ghi cũ đã xong/thất bại khi đưa lại", async () => {
    const { queue, executeMany } = setup();

    await queue.enqueue(
      [{ id: "job-1", shopDomain: "a.myshopify.com", batchId: null }],
      "interactive",
      1,
      { replaceFinished: true },
    );

    expect(executeMany).toHaveBeenCalledWith([
      expect.objectContaining({ jobId: "wm_job-1", replaceFinished: true }),
    ]);
  });

  it("trả về id job watermark còn sống trong queue", async () => {
    const { queue, inspector } = setup();

    expect(await queue.findAlive(["job-1", "job-2"])).toEqual(new Set(["job-1"]));
    expect(inspector.findLiveJobIds).toHaveBeenCalledWith(["wm_job-1", "wm_job-2"], ["interactive", "bulk"]);
  });
});
