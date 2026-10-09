import { afterEach, describe, expect, it, vi } from "vitest";
import { BullMqWorker } from "./BullMqWorker.ts";
import { DEFAULT_STUCK_AFTER_MS } from "./JobWatchdog.ts";

function job(name: string) {
  return { id: "job-1", name, data: {}, attemptsMade: 0, opts: { attempts: 3 } };
}

function setup() {
  const exit = vi.fn();
  const worker = new BullMqWorker({ lanes: [], connection: {}, exit });
  return { worker, exit };
}

describe("BullMqWorker watchdog", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("thoát tiến trình khi job chạy quá giới hạn (tiến trình đã đơ)", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { worker, exit } = setup();
    worker.registerHandler("HANGS", () => new Promise(() => undefined), { stuckAfterMs: 60_000 });

    void worker.process(job("HANGS"));
    await vi.advanceTimersByTimeAsync(59_999);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("dùng giới hạn mặc định khi không khai báo", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { worker, exit } = setup();
    worker.registerHandler("HANGS", () => new Promise(() => undefined));

    void worker.process(job("HANGS"));
    await vi.advanceTimersByTimeAsync(DEFAULT_STUCK_AFTER_MS);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("không canh job được đánh dấu stuckAfterMs: null", async () => {
    vi.useFakeTimers();
    const { worker, exit } = setup();
    worker.registerHandler("LONG", () => new Promise(() => undefined), { stuckAfterMs: null });

    void worker.process(job("LONG"));
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(exit).not.toHaveBeenCalled();
  });

  it("job xong hoặc lỗi trước giới hạn thì không thoát", async () => {
    vi.useFakeTimers();
    const { worker, exit } = setup();
    worker.registerHandler("OK", async () => undefined, { stuckAfterMs: 1_000 });
    worker.registerHandler("FAILS", async () => {
      throw new Error("lỗi thường");
    }, { stuckAfterMs: 1_000 });

    await worker.process(job("OK"));
    await expect(worker.process(job("FAILS"))).rejects.toThrow("lỗi thường");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(exit).not.toHaveBeenCalled();
  });
});
