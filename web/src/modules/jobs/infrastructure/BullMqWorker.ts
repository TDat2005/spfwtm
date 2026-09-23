import {
  Worker,
  type ConnectionOptions,
  type Job,
} from "bullmq";

export type BullMqJobHandler = (
  payload: Record<string, unknown>
) => Promise<void>;

interface BullMqWorkerOptions {
  queueName: string;
  connection: ConnectionOptions;
  concurrency: number;
  prefix?: string;
}

/** Consumer adapter: BullMQ đẩy job tới đúng application handler. */
export class BullMqWorker {
  private readonly handlers = new Map<string, BullMqJobHandler>();
  private worker: Worker<Record<string, unknown>> | null = null;

  constructor(private readonly options: BullMqWorkerOptions) {}

  registerHandler(jobType: string, handler: BullMqJobHandler): void {
    if (this.worker) {
      throw new Error("Phải đăng ký handler trước khi khởi động BullMQ worker");
    }
    this.handlers.set(jobType, handler);
  }

  start(): void {
    if (this.worker) return;

    this.worker = new Worker<Record<string, unknown>>(
      this.options.queueName,
      async (job) => this.process(job),
      {
        connection: this.options.connection,
        concurrency: this.options.concurrency,
        prefix: this.options.prefix,
      }
    );

    this.worker.on("completed", (job) => {
      console.log(`[BullMQ] Hoàn thành ${job.name} (${job.id})`);
    });
    this.worker.on("failed", (job, error) => {
      console.error(
        `[BullMQ] Thất bại ${job?.name ?? "unknown"} (${job?.id ?? "unknown"}):`,
        error.message
      );
    });
    this.worker.on("error", (error) => {
      console.error("[BullMQ] Lỗi kết nối worker:", error.message);
    });

    console.log(
      `[BullMQ] Worker '${this.options.queueName}' đã khởi động, concurrency=${this.options.concurrency}.`
    );
  }

  async stop(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    if (!worker) return;
    await worker.close();
    console.log("[BullMQ] Worker đã dừng an toàn.");
  }

  private async process(job: Job<Record<string, unknown>>): Promise<void> {
    const handler = this.handlers.get(job.name);
    if (!handler) {
      throw new Error(`Không tìm thấy handler cho job type ${job.name}`);
    }
    await handler(job.data);
  }
}
