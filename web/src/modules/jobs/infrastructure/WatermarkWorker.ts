import type { RunPendingJobs } from "../application/RunPendingJobs.ts";

export class WatermarkWorker {
  private timer: NodeJS.Timeout | null = null;
  private isBusy = false;
  private isRunning = false;

  constructor(
    private readonly runPendingJobs: RunPendingJobs,
    private readonly pollIntervalMs = 2000
  ) {}

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.scheduleNext(100);
    console.log("[WatermarkWorker] Đã khởi động background worker.");
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log("[WatermarkWorker] Đã dừng background worker.");
  }

  trigger(): void {
    if (!this.isRunning || this.isBusy) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.scheduleNext(10);
  }

  private scheduleNext(delayMs: number): void {
    if (!this.isRunning) return;
    this.timer = setTimeout(async () => {
      await this.tick();
      if (this.isRunning) {
        this.scheduleNext(this.pollIntervalMs);
      }
    }, delayMs);
  }

  private async tick(): Promise<void> {
    if (this.isBusy) return;
    this.isBusy = true;

    try {
      let processed = false;
      do {
        processed = await this.runPendingJobs.executeNext();
      } while (processed && this.isRunning);
    } catch (error: unknown) {
      console.error(
        "[WatermarkWorker] Lỗi trong worker tick:",
        error instanceof Error ? error.message : error
      );
    } finally {
      this.isBusy = false;
    }
  }
}
