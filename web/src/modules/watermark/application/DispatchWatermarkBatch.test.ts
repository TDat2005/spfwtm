import { describe, expect, it, vi } from "vitest";
import type { EnqueueJob, EnqueueJobInput } from "../../jobs/application/EnqueueJob.ts";
import type {
  BatchDispatchState,
  CreatedBatchJob,
  WatermarkBatchDispatchRepository,
} from "./BulkWatermarkPorts.ts";
import {
  BULK_WINDOW_SIZE,
  DispatchWatermarkBatch,
  STALE_ENQUEUE_MS,
} from "./DispatchWatermarkBatch.ts";

const NOW = new Date("2026-10-07T10:00:00Z");

interface FakeJob {
  id: string;
  batchId: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED";
  enqueuedAt: Date | null;
}

/** Repository trong bộ nhớ, mô phỏng đúng luật của bản Prisma. */
class FakeRepository implements WatermarkBatchDispatchRepository {
  readonly jobs: FakeJob[] = [];
  readonly batches = new Map<string, { shopDomain: string; totalJobs: number }>();

  addBatch(batchId: string, shopDomain: string, totalJobs: number): void {
    this.batches.set(batchId, { shopDomain, totalJobs });
    for (let i = 0; i < totalJobs; i++) {
      this.jobs.push({
        id: `${batchId}-${String(i).padStart(5, "0")}`,
        batchId,
        status: "PENDING",
        enqueuedAt: null,
      });
    }
  }

  async getDispatchState(batchId: string, staleBefore: Date): Promise<BatchDispatchState | null> {
    const batch = this.batches.get(batchId);
    if (!batch) return null;
    const inFlightJobs = this.jobs.filter(
      (job) =>
        job.batchId === batchId &&
        (job.status === "PROCESSING" ||
          (job.status === "PENDING" && job.enqueuedAt !== null && job.enqueuedAt >= staleBefore)),
    ).length;
    return { batchId, ...batch, inFlightJobs };
  }

  async claimJobs(batchId: string, limit: number, staleBefore: Date): Promise<CreatedBatchJob[]> {
    const claimed = this.undispatched(staleBefore)
      .filter((job) => job.batchId === batchId)
      .slice(0, limit);
    for (const job of claimed) job.enqueuedAt = NOW;
    return claimed.map((job) => ({ id: job.id, productId: `product-${job.id}` }));
  }

  async releaseJobs(jobIds: string[]): Promise<void> {
    for (const job of this.jobs) if (jobIds.includes(job.id)) job.enqueuedAt = null;
  }

  async listBatchesNeedingDispatch(staleBefore: Date, limit: number): Promise<string[]> {
    return [...new Set(this.undispatched(staleBefore).map((job) => job.batchId))].slice(0, limit);
  }

  private undispatched(staleBefore: Date): FakeJob[] {
    return this.jobs.filter(
      (job) => job.status === "PENDING" && (job.enqueuedAt === null || job.enqueuedAt < staleBefore),
    );
  }
}

function setup() {
  const repository = new FakeRepository();
  const enqueued: EnqueueJobInput[] = [];
  const executeMany = vi.fn(async (inputs: EnqueueJobInput[]) => {
    enqueued.push(...inputs);
    return [];
  });
  const dispatcher = new DispatchWatermarkBatch(
    repository,
    { executeMany } as unknown as EnqueueJob,
    () => NOW,
  );
  return { repository, dispatcher, enqueued, executeMany };
}

describe("DispatchWatermarkBatch", () => {
  it("đưa toàn bộ batch nhỏ vào lane interactive ngay", async () => {
    const { repository, dispatcher, enqueued } = setup();
    repository.addBatch("small", "a.myshopify.com", 10);

    expect(await dispatcher.execute("small")).toBe(10);

    expect(enqueued).toHaveLength(10);
    expect(enqueued.every((job) => job.lane === "interactive")).toBe(true);
    expect(enqueued[0]).toMatchObject({
      jobName: "WATERMARK_PROCESS_V1",
      jobId: "wm_small-00000",
      payload: { jobId: "small-00000", shopDomain: "a.myshopify.com", batchId: "small" },
    });
  });

  it("chỉ giữ một cửa sổ nhỏ của batch lớn trong lane bulk", async () => {
    const { repository, dispatcher, enqueued } = setup();
    repository.addBatch("big", "a.myshopify.com", 10_000);

    expect(await dispatcher.execute("big")).toBe(BULK_WINDOW_SIZE);
    // Gọi lại khi chưa job nào xong thì không đưa thêm.
    expect(await dispatcher.execute("big")).toBe(0);

    expect(enqueued).toHaveLength(BULK_WINDOW_SIZE);
    expect(enqueued.every((job) => job.lane === "bulk")).toBe(true);
  });

  it("bù đúng số chỗ trống khi job hoàn thành", async () => {
    const { repository, dispatcher, enqueued } = setup();
    repository.addBatch("big", "a.myshopify.com", 1_000);
    await dispatcher.execute("big");

    for (const job of repository.jobs.slice(0, 3)) job.status = "COMPLETED";
    expect(await dispatcher.execute("big")).toBe(3);
    expect(enqueued).toHaveLength(BULK_WINDOW_SIZE + 3);
  });

  it("để batch của shop khác xen vào thay vì chờ batch 10.000 sản phẩm chạy hết", async () => {
    const { repository, dispatcher, enqueued } = setup();
    repository.addBatch("big", "a.myshopify.com", 10_000);
    repository.addBatch("other", "b.myshopify.com", 200);

    await dispatcher.execute("big");
    await dispatcher.execute("other");

    const otherShopPosition = enqueued.findIndex((job) => job.payload.batchId === "other");
    expect(otherShopPosition).toBe(BULK_WINDOW_SIZE);
  });

  it("trả job về trạng thái chưa vào queue nếu Redis lỗi", async () => {
    const { repository, dispatcher, executeMany } = setup();
    repository.addBatch("big", "a.myshopify.com", 100);
    executeMany.mockRejectedValueOnce(new Error("Redis down"));

    await expect(dispatcher.execute("big")).rejects.toThrow("Redis down");
    expect(repository.jobs.every((job) => job.enqueuedAt === null)).toBe(true);
  });

  it("sweep đưa lại job đã vào queue quá lâu mà vẫn PENDING", async () => {
    const { repository, dispatcher, enqueued } = setup();
    repository.addBatch("big", "a.myshopify.com", 100);
    const lostAt = new Date(NOW.getTime() - STALE_ENQUEUE_MS - 1);
    for (const job of repository.jobs.slice(0, BULK_WINDOW_SIZE)) job.enqueuedAt = lostAt;

    expect(await dispatcher.sweep()).toBe(BULK_WINDOW_SIZE);
    expect(enqueued[0]?.jobId).toBe("wm_big-00000");
  });
});
