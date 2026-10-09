import { describe, expect, it, vi } from "vitest";
import {
  ABANDONED_JOB_MESSAGE,
  PROCESSING_CHECK_AFTER_MS,
  QUEUED_CHECK_AFTER_MS,
  RecoverWatermarkJobs,
} from "./RecoverWatermarkJobs.ts";
import type {
  ProcessingJobRecord,
  QueuedJobRecord,
  QueuedWatermarkJob,
  WatermarkLane,
  WatermarkQueue,
  WatermarkRecoveryRepository,
} from "./WatermarkQueuePorts.ts";

const NOW = new Date("2026-10-08T10:00:00Z");
const LONG_AGO = new Date(NOW.getTime() - QUEUED_CHECK_AFTER_MS - PROCESSING_CHECK_AFTER_MS);

interface FakeJob {
  id: string;
  status: "PENDING" | "PROCESSING" | "FAILED" | "COMPLETED";
  batchId: string | null;
  batchTotalJobs: number | null;
  enqueuedAt: Date | null;
  updatedAt: Date;
  errorMessage: string | null;
}

class FakeRepository implements WatermarkRecoveryRepository {
  readonly jobs = new Map<string, FakeJob>();

  add(job: Partial<FakeJob> & Pick<FakeJob, "id" | "status">): void {
    this.jobs.set(job.id, {
      batchId: null,
      batchTotalJobs: null,
      enqueuedAt: LONG_AGO,
      updatedAt: LONG_AGO,
      errorMessage: null,
      ...job,
    });
  }

  async listQueuedBefore(before: Date, limit: number): Promise<QueuedJobRecord[]> {
    return [...this.jobs.values()]
      .filter((job) => job.status === "PENDING" && job.enqueuedAt !== null && job.enqueuedAt < before)
      .slice(0, limit)
      .map((job) => ({
        id: job.id,
        shopDomain: "a.myshopify.com",
        batchId: job.batchId,
        batchTotalJobs: job.batchTotalJobs,
        enqueuedAt: job.enqueuedAt!,
      }));
  }

  async touchQueued(jobId: string, seenEnqueuedAt: Date, at: Date): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (job?.status !== "PENDING" || job.enqueuedAt?.getTime() !== seenEnqueuedAt.getTime()) return false;
    job.enqueuedAt = at;
    return true;
  }

  async listProcessingBefore(before: Date, limit: number): Promise<ProcessingJobRecord[]> {
    return [...this.jobs.values()]
      .filter((job) => job.status === "PROCESSING" && job.updatedAt < before)
      .slice(0, limit)
      .map((job) => ({ id: job.id, updatedAt: job.updatedAt }));
  }

  async failProcessing(jobId: string, seenUpdatedAt: Date, message: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (job?.status !== "PROCESSING" || job.updatedAt.getTime() !== seenUpdatedAt.getTime()) return false;
    job.status = "FAILED";
    job.errorMessage = message;
    return true;
  }
}

function setup(alive: string[] = []) {
  const repository = new FakeRepository();
  const enqueued: Array<QueuedWatermarkJob & { lane: WatermarkLane; replaceFinished?: boolean }> = [];
  const queue: WatermarkQueue = {
    enqueue: vi.fn(async (
      jobs: QueuedWatermarkJob[],
      lane: WatermarkLane,
      _priority: number,
      options?: { replaceFinished?: boolean },
    ) => {
      enqueued.push(...jobs.map((job) => ({ ...job, lane, replaceFinished: options?.replaceFinished })));
    }),
    findAlive: vi.fn(async (ids: string[]) => new Set(ids.filter((id) => alive.includes(id)))),
  };
  const recover = new RecoverWatermarkJobs(repository, queue, () => NOW);
  return { repository, queue, enqueued, recover };
}

describe("RecoverWatermarkJobs", () => {
  it("đánh FAILED job PROCESSING mà worker đã bỏ dở (queue không còn job)", async () => {
    const { repository, recover } = setup();
    repository.add({ id: "zombie", status: "PROCESSING", batchId: "big", batchTotalJobs: 5_000 });

    expect(await recover.execute()).toEqual({ requeuedJobs: 0, failedJobs: 1 });
    expect(repository.jobs.get("zombie")).toMatchObject({
      status: "FAILED",
      errorMessage: ABANDONED_JOB_MESSAGE,
    });
  });

  it("không đụng tới job PROCESSING còn trong queue (đang chạy hoặc chờ retry)", async () => {
    const { repository, recover } = setup(["slow"]);
    repository.add({ id: "slow", status: "PROCESSING" });

    expect(await recover.execute()).toEqual({ requeuedJobs: 0, failedJobs: 0 });
    expect(repository.jobs.get("slow")?.status).toBe("PROCESSING");
  });

  it("không đánh FAILED job vừa đổi trạng thái sau lúc đọc", async () => {
    const { repository, queue, recover } = setup();
    repository.add({ id: "done", status: "PROCESSING" });
    vi.mocked(queue.findAlive).mockImplementationOnce(async () => {
      repository.jobs.get("done")!.status = "COMPLETED";
      return new Set();
    });

    expect((await recover.execute()).failedJobs).toBe(0);
    expect(repository.jobs.get("done")?.status).toBe("COMPLETED");
  });

  it("bỏ qua job PROCESSING còn mới", async () => {
    const { repository, queue, recover } = setup();
    repository.add({ id: "fresh", status: "PROCESSING", updatedAt: NOW });

    await recover.execute();
    expect(queue.findAlive).not.toHaveBeenCalled();
    expect(repository.jobs.get("fresh")?.status).toBe("PROCESSING");
  });

  it("đưa lại job PENDING đã vào queue nhưng bị mất, đúng lane của nó", async () => {
    const { repository, enqueued, recover } = setup();
    repository.add({ id: "lost-big", status: "PENDING", batchId: "big", batchTotalJobs: 5_000 });
    repository.add({ id: "lost-small", status: "PENDING", batchId: "small", batchTotalJobs: 10 });
    repository.add({ id: "lost-single", status: "PENDING" });

    expect((await recover.execute()).requeuedJobs).toBe(3);
    expect(enqueued).toEqual([
      { id: "lost-big", shopDomain: "a.myshopify.com", batchId: "big", lane: "bulk", replaceFinished: true },
      { id: "lost-small", shopDomain: "a.myshopify.com", batchId: "small", lane: "interactive", replaceFinished: true },
      { id: "lost-single", shopDomain: "a.myshopify.com", batchId: null, lane: "interactive", replaceFinished: true },
    ]);
    expect(repository.jobs.get("lost-big")?.enqueuedAt).toEqual(NOW);
  });

  it("job PENDING còn trong queue chỉ được ghi lại thời điểm xác nhận", async () => {
    const { repository, enqueued, recover } = setup(["waiting"]);
    repository.add({ id: "waiting", status: "PENDING", batchId: "big", batchTotalJobs: 5_000 });

    expect((await recover.execute()).requeuedJobs).toBe(0);
    expect(enqueued).toHaveLength(0);
    expect(repository.jobs.get("waiting")?.enqueuedAt).toEqual(NOW);
  });

  it("không đưa lại job PENDING chưa từng vào queue (việc của dispatcher)", async () => {
    const { repository, enqueued, recover } = setup();
    repository.add({ id: "undispatched", status: "PENDING", batchId: "big", batchTotalJobs: 5_000, enqueuedAt: null });

    await recover.execute();
    expect(enqueued).toHaveLength(0);
  });
});
