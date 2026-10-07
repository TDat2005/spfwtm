import {
  Worker,
  type ConnectionOptions,
  type Job,
} from "bullmq";
import type { JobLane } from "../domain/JobDefinitions.ts";

export interface BullMqJobContext {
  isFinalAttempt: boolean;
}

export type BullMqJobHandler = (
  payload: Record<string, unknown>,
  context: BullMqJobContext
) => Promise<void>;

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
}

export class BullMqWorker {
  private readonly handlers = new Map<string, BullMqJobHandler>();
  private workers: Worker<Record<string, unknown>>[] = [];
  private started = false;

  constructor(private readonly options: BullMqWorkerOptions) {}

  registerHandler(jobType: string, handler: BullMqJobHandler): void {
    if (this.started) {
      throw new Error("Phải đăng ký handler trước khi khởi động BullMQ worker");
    }
    this.handlers.set(jobType, handler);
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

  private async process(job: Job<Record<string, unknown>>): Promise<void> {
    const handler = this.handlers.get(job.name);
    if (!handler) {
      throw new Error(`Không tìm thấy handler cho job type ${job.name}`);
    }
    await handler(job.data, {
      isFinalAttempt: job.attemptsMade + 1 >= (job.opts.attempts ?? 1),
    });
  }
}
