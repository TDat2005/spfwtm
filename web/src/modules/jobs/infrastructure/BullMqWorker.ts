import {
  Worker,
  type ConnectionOptions,
  type Job,
} from "bullmq";
import type { JobLane } from "../domain/JobDefinitions.ts";
import { DEFAULT_STUCK_AFTER_MS, runWithWatchdog } from "./JobWatchdog.ts";

export interface BullMqJobContext {
  isFinalAttempt: boolean;
}

export type BullMqJobHandler = (
  payload: Record<string, unknown>,
  context: BullMqJobContext
) => Promise<void>;

export interface BullMqHandlerOptions {
  /**
   * Job chạy quá thời gian này thì coi tiến trình đã đơ: ghi log rồi thoát để
   * lock hết hạn và worker khác nhận lại job. Mặc định 10 phút; `null` = không
   * canh (job quét cả shop, thời gian không giới hạn trước được).
   */
  stuckAfterMs?: number | null;
}

interface RegisteredHandler {
  handler: BullMqJobHandler;
  stuckAfterMs: number | null;
}

export interface BullMqWorkerLane {
  lane: JobLane;
  queueName: string;
  concurrency: number;
}

interface BullMqWorkerOptions {
  /** Rỗng nghĩa là tiến trình này không xử lý job (chỉ đưa job vào queue). */
  lanes: BullMqWorkerLane[];
  connection: ConnectionOptions;
  prefix?: string;
  /** Thoát tiến trình khi job bị kẹt (thay được trong test). */
  exit?: (code: number) => void;
}

export class BullMqWorker {
  private readonly handlers = new Map<string, RegisteredHandler>();
  private workers: Worker<Record<string, unknown>>[] = [];
  private started = false;

  constructor(private readonly options: BullMqWorkerOptions) {}

  registerHandler(
    jobType: string,
    handler: BullMqJobHandler,
    options: BullMqHandlerOptions = {}
  ): void {
    if (this.started) {
      throw new Error("Phải đăng ký handler trước khi khởi động BullMQ worker");
    }
    this.handlers.set(jobType, {
      handler,
      stuckAfterMs:
        options.stuckAfterMs === undefined ? DEFAULT_STUCK_AFTER_MS : options.stuckAfterMs,
    });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    if (this.options.lanes.length === 0) {
      console.log("[BullMQ] Tiến trình này không chạy worker (WORKER_ENABLED=false).");
      return;
    }
    this.workers = this.options.lanes.map((lane) => this.startLane(lane));
  }

  async stop(): Promise<void> {
    const workers = this.workers;
    this.workers = [];
    this.started = false;
    if (workers.length === 0) return;
    await Promise.all(workers.map((worker) => worker.close()));
    console.log("[BullMQ] Worker đã dừng an toàn.");
  }

  private startLane(lane: BullMqWorkerLane): Worker<Record<string, unknown>> {
    const worker = new Worker<Record<string, unknown>>(
      lane.queueName,
      async (job) => this.process(job),
      {
        connection: this.options.connection,
        concurrency: lane.concurrency,
        prefix: this.options.prefix,
      }
    );

    worker.on("completed", (job) => {
      console.log(`[BullMQ:${lane.lane}] Hoàn thành ${job.name} (${job.id})`);
    });
    worker.on("failed", (job, error) => {
      console.error(
        `[BullMQ:${lane.lane}] Thất bại ${job?.name ?? "unknown"} (${job?.id ?? "unknown"}):`,
        error.message
      );
    });
    worker.on("error", (error) => {
      console.error(`[BullMQ:${lane.lane}] Lỗi kết nối worker:`, error.message);
    });

    console.log(
      `[BullMQ] Worker lane '${lane.lane}' (queue '${lane.queueName}') đã khởi động, concurrency=${lane.concurrency}.`
    );
    return worker;
  }

  /** Chạy handler của job; tách khỏi BullMQ để test được. */
  async process(job: Pick<Job<Record<string, unknown>>, "id" | "name" | "data" | "attemptsMade" | "opts">): Promise<void> {
    const registered = this.handlers.get(job.name);
    if (!registered) {
      throw new Error(`Không tìm thấy handler cho job type ${job.name}`);
    }
    await runWithWatchdog(
      () =>
        registered.handler(job.data, {
          isFinalAttempt: job.attemptsMade + 1 >= (job.opts.attempts ?? 1),
        }),
      registered.stuckAfterMs,
      () => {
        console.error(
          `[BullMQ] Job ${job.name} (${job.id}) chạy quá ${Math.round((registered.stuckAfterMs ?? 0) / 1000)} giây: ` +
            "tiến trình có thể đã đơ. Thoát để worker khác nhận lại các job đang dở."
        );
        (this.options.exit ?? ((code) => process.exit(code)))(1);
      }
    );
  }
}
