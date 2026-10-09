import { describe, expect, it, vi } from "vitest";
import { EnqueueWatermarkJob } from "./EnqueueWatermarkJob.ts";
import type { WatermarkQueue } from "./WatermarkQueuePorts.ts";

const NOW = new Date("2026-10-08T10:00:00Z");

function setup(marked: { batchId: string | null } | null) {
  const markEnqueued = vi.fn(async () => marked);
  const queue: WatermarkQueue = {
    enqueue: vi.fn(async () => undefined),
    findAlive: async () => new Set(),
  };
  const useCase = new EnqueueWatermarkJob({ markEnqueued }, queue, () => NOW);
  return { useCase, markEnqueued, queue };
}

describe("EnqueueWatermarkJob", () => {
  it("ghi enqueuedAt rồi đưa job vào lane interactive, thay bản ghi cũ của lần chạy trước", async () => {
    const { useCase, markEnqueued, queue } = setup({ batchId: "batch-1" });

    await useCase.execute({ jobId: "job-1", shopDomain: "a.myshopify.com", priority: 1 });

    expect(markEnqueued).toHaveBeenCalledWith("job-1", NOW);
    expect(queue.enqueue).toHaveBeenCalledWith(
      [{ id: "job-1", shopDomain: "a.myshopify.com", batchId: "batch-1" }],
      "interactive",
      1,
      { replaceFinished: true },
    );
  });

  it("bỏ qua job không còn PENDING", async () => {
    const { useCase, queue } = setup(null);

    await useCase.execute({ jobId: "job-1", shopDomain: "a.myshopify.com", priority: 1 });

    expect(queue.enqueue).not.toHaveBeenCalled();
  });
});
