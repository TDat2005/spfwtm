import { describe, expect, it, vi } from "vitest";
import type {
  BatchDispatchState,
  BatchSize,
  ClaimedBatchJob,
  WatermarkBatchDispatchRepository,
} from "./BulkWatermarkPorts.ts";
import {
  BULK_SHOP_WINDOW,
  DispatchWatermarkBatch,
  INTERACTIVE_SHOP_WINDOW,
  batchSizeOf,
} from "./DispatchWatermarkBatch.ts";
import type {
  QueuedWatermarkJob,
  WatermarkLane,
  WatermarkQueue,
} from "./WatermarkQueuePorts.ts";

const NOW = new Date("2026-10-07T10:00:00Z");

interface FakeJob {
  id: string;
  batchId: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED";
  enqueuedAt: Date | null;
}

interface FakeBatch {
  shopId: string;
  totalJobs: number;
  createdAt: number;
}

/** Repository trong bộ nhớ, mô phỏng đúng luật của bản Prisma. */
class FakeRepository implements WatermarkBatchDispatchRepository {
  readonly jobs: FakeJob[] = [];
  readonly batches = new Map<string, FakeBatch>();

  addBatch(batchId: string, shopId: string, totalJobs: number): void {
    this.batches.set(batchId, { shopId, totalJobs, createdAt: this.batches.size });
    for (let i = 0; i < totalJobs; i++) {
      this.jobs.push({
        id: `${batchId}-${String(i).padStart(5, "0")}`,
        batchId,
        status: "PENDING",
        enqueuedAt: null,
      });
    }
  }

  complete(count: number, batchId?: string): void {
    const running = this.jobs.filter(
      (job) => job.enqueuedAt !== null && job.status === "PENDING" && (!batchId || job.batchId === batchId),
    );
    for (const job of running.slice(0, count)) job.status = "COMPLETED";
  }

  inFlight(batchId: string): number {
    return this.jobs.filter((job) => job.batchId === batchId && isInFlight(job)).length;
  }

  async getDispatchState(batchId: string): Promise<BatchDispatchState | null> {
    const batch = this.batches.get(batchId);
    if (!batch) return null;
    const size = batchSizeOf(batch.totalJobs);
    const inFlightJobs = this.jobs.filter(
      (job) => this.sameClass(job.batchId, batch.shopId, size) && isInFlight(job),
    ).length;
    return { batchId, shopId: batch.shopId, shopDomain: `${batch.shopId}.myshopify.com`, size, inFlightJobs };
  }

  async claimJobs(shopId: string, size: BatchSize, limit: number): Promise<ClaimedBatchJob[]> {
    const batchOrder = (batchId: string) => this.batches.get(batchId)!.createdAt;
    const claimed = this.jobs
      .filter((job) => this.sameClass(job.batchId, shopId, size) && isUndispatched(job))
      .sort((a, b) => batchOrder(a.batchId) - batchOrder(b.batchId) || a.id.localeCompare(b.id))
      .slice(0, limit);
    for (const job of claimed) job.enqueuedAt = NOW;
    return claimed.map((job) => ({ id: job.id, batchId: job.batchId }));
  }

  async releaseJobs(jobIds: string[]): Promise<void> {
    for (const job of this.jobs) if (jobIds.includes(job.id)) job.enqueuedAt = null;
  }

  async listBatchesNeedingDispatch(afterBatchId: string | null, limit: number): Promise<string[]> {
    return [...new Set(this.jobs.filter(isUndispatched).map((job) => job.batchId))]
      .sort()
      .filter((batchId) => afterBatchId === null || batchId > afterBatchId)
      .slice(0, limit);
  }

  private sameClass(batchId: string, shopId: string, size: BatchSize): boolean {
    const batch = this.batches.get(batchId)!;
    return batch.shopId === shopId && batchSizeOf(batch.totalJobs) === size;
  }
}

function isInFlight(job: FakeJob): boolean {
  return job.status === "PROCESSING" || (job.status === "PENDING" && job.enqueuedAt !== null);
}

function isUndispatched(job: FakeJob): boolean {
  return job.status === "PENDING" && job.enqueuedAt === null;
}

interface Enqueued extends QueuedWatermarkJob {
  lane: WatermarkLane;
  priority: number;
}

function setup() {
  const repository = new FakeRepository();
  const enqueued: Enqueued[] = [];
  const enqueue = vi.fn(async (jobs: QueuedWatermarkJob[], lane: WatermarkLane, priority: number) => {
    enqueued.push(...jobs.map((job) => ({ ...job, lane, priority })));
  });
  const queue: WatermarkQueue = { enqueue, findAlive: async () => new Set() };
  const dispatcher = new DispatchWatermarkBatch(repository, queue);
  return { repository, dispatcher, enqueued, enqueue };
}

describe("DispatchWatermarkBatch", () => {
  it("đưa toàn bộ batch nhỏ vào lane interactive ngay", async () => {
    const { repository, dispatcher, enqueued } = setup();
    repository.addBatch("small", "a", 50);

    expect(await dispatcher.execute("small")).toBe(50);

    expect(enqueued.every((job) => job.lane === "interactive")).toBe(true);
    expect(enqueued[0]).toEqual({
      id: "small-00000",
      shopDomain: "a.myshopify.com",
      batchId: "small",
      lane: "interactive",
      priority: 2,
    });
  });

  it("chỉ giữ một cửa sổ nhỏ của batch lớn trong lane bulk", async () => {
    const { repository, dispatcher, enqueued } = setup();
    repository.addBatch("big", "a", 5_000);

    expect(await dispatcher.execute("big")).toBe(BULK_SHOP_WINDOW);
    // Gọi lại khi chưa job nào xong thì không đưa thêm.
    expect(await dispatcher.execute("big")).toBe(0);

    expect(enqueued).toHaveLength(BULK_SHOP_WINDOW);
    expect(enqueued.every((job) => job.lane === "bulk")).toBe(true);
  });

  it("bù đúng số chỗ trống khi job hoàn thành", async () => {
    const { repository, dispatcher, enqueued } = setup();
    repository.addBatch("big", "a", 1_000);
    await dispatcher.execute("big");

    repository.complete(3);
    expect(await dispatcher.execute("big")).toBe(3);
    expect(enqueued).toHaveLength(BULK_SHOP_WINDOW + 3);
  });

  it("batch 100 sản phẩm của shop B xen vào ngay, không chờ shop A chạy hết", async () => {
    const { repository, dispatcher, enqueued } = setup();
    repository.addBatch("a-big", "a", 5_000);
    repository.addBatch("b-100", "b", 100);

    await dispatcher.execute("a-big");
    await dispatcher.execute("b-100");

    // Shop B chỉ đứng sau phần cửa sổ của shop A đang nằm trong queue.
    const firstOfB = enqueued.findIndex((job) => job.batchId === "b-100");
    expect(firstOfB).toBe(BULK_SHOP_WINDOW);
    expect(repository.inFlight("b-100")).toBe(BULK_SHOP_WINDOW);
  });

  it("cửa sổ tính theo shop: chia batch nhỏ ra không giành thêm chỗ", async () => {
    const { repository, dispatcher } = setup();
    repository.addBatch("a-1", "a", 5_000);
    repository.addBatch("a-2", "a", 5_000);

    await dispatcher.execute("a-1");
    expect(await dispatcher.execute("a-2")).toBe(0);

    expect(repository.inFlight("a-1")).toBe(BULK_SHOP_WINDOW);
    expect(repository.inFlight("a-2")).toBe(0);
  });

  it("batch tạo trước của cùng shop chạy trước, xong thì chuyển sang batch sau", async () => {
    const { repository, dispatcher } = setup();
    repository.addBatch("a-1", "a", 60);
    repository.addBatch("a-2", "a", 60);
    await dispatcher.execute("a-1");

    repository.complete(BULK_SHOP_WINDOW);
    await dispatcher.execute("a-1");
    repository.complete(BULK_SHOP_WINDOW);
    // Job cuối của a-1 xong: dispatcher của a-1 bù chỗ bằng job của a-2.
    expect(await dispatcher.execute("a-1")).toBe(BULK_SHOP_WINDOW);

    expect(repository.inFlight("a-1")).toBe(10);
    expect(repository.inFlight("a-2")).toBe(BULK_SHOP_WINDOW - 10);
  });

  it("giới hạn lane interactive theo shop khi shop tạo liên tiếp nhiều batch nhỏ", async () => {
    const { repository, dispatcher, enqueued } = setup();
    for (let i = 0; i < 20; i++) repository.addBatch(`a-small-${i}`, "a", 50);
    repository.addBatch("b-small", "b", 50);

    for (let i = 0; i < 20; i++) await dispatcher.execute(`a-small-${i}`);
    await dispatcher.execute("b-small");

    const fromA = enqueued.filter((job) => job.batchId?.startsWith("a-small"));
    expect(fromA).toHaveLength(INTERACTIVE_SHOP_WINDOW);
    expect(enqueued.filter((job) => job.batchId === "b-small")).toHaveLength(50);
  });

  it("batch nhỏ của shop vẫn chạy ngay khi shop đang có batch lớn", async () => {
    const { repository, dispatcher } = setup();
    repository.addBatch("a-big", "a", 5_000);
    repository.addBatch("a-small", "a", 10);

    await dispatcher.execute("a-big");
    expect(await dispatcher.execute("a-small")).toBe(10);
  });

  it("trả job về trạng thái chưa vào queue nếu Redis lỗi", async () => {
    const { repository, dispatcher, enqueue } = setup();
    repository.addBatch("big", "a", 100);
    enqueue.mockRejectedValueOnce(new Error("Redis down"));

    await expect(dispatcher.execute("big")).rejects.toThrow("Redis down");
    expect(repository.jobs.every((job) => job.enqueuedAt === null)).toBe(true);
  });

  it("sweep bù chỗ cho mọi batch còn job chưa vào queue, qua nhiều trang", async () => {
    const { repository, dispatcher, enqueued } = setup();
    for (let i = 0; i < 150; i++) repository.addBatch(`b-${String(i).padStart(3, "0")}`, `shop-${i}`, 2);

    expect(await dispatcher.sweep()).toBe(300);
    expect(enqueued).toHaveLength(300);
    expect(enqueued[0]).toMatchObject({ id: "b-000-00000", lane: "interactive" });
  });
});
