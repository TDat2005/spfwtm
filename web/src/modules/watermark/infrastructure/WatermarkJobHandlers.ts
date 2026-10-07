import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleInit,
} from "@nestjs/common";
import { EnqueueJob } from "../../jobs/application/EnqueueJob.ts";
import {
  PUBLICATION_PUBLISH_V1,
  WATERMARK_BATCH_DISPATCH_V1,
  WATERMARK_PROCESS_V1,
  assertJobVersion,
} from "../../jobs/domain/JobDefinitions.ts";
import { BullMqJobQueue } from "../../jobs/infrastructure/BullMqJobQueue.ts";
import {
  BullMqWorker,
  type BullMqJobContext,
} from "../../jobs/infrastructure/BullMqWorker.ts";
import { DispatchWatermarkBatch } from "../application/DispatchWatermarkBatch.ts";
import { ProcessWatermarkJob } from "../application/ProcessWatermarkJob.ts";

const BATCH_SWEEP_EVERY_MS = 60_000;

@Injectable()
export class WatermarkJobHandlers implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger("WatermarkJobs");

  constructor(
    @Inject(BullMqWorker) private readonly worker: BullMqWorker,
    @Inject(BullMqJobQueue) private readonly queue: BullMqJobQueue,
    @Inject(ProcessWatermarkJob) private readonly processWatermarkJob: ProcessWatermarkJob,
    @Inject(DispatchWatermarkBatch) private readonly dispatchBatch: DispatchWatermarkBatch,
    @Inject(EnqueueJob) private readonly enqueueJob: EnqueueJob,
  ) {}

  onModuleInit(): void {
    this.worker.registerHandler(WATERMARK_PROCESS_V1.jobName, async (payload, context) => {
      assertJobVersion(payload, WATERMARK_PROCESS_V1);
      await this.process(payload, context);
    });

    this.worker.registerHandler("WATERMARK_PROCESS", (payload, context) =>
      this.process(payload, context),
    );

    this.worker.registerHandler(WATERMARK_BATCH_DISPATCH_V1.jobName, async (payload) => {
      assertJobVersion(payload, WATERMARK_BATCH_DISPATCH_V1);
      const dispatched = await this.dispatchBatch.sweep();
      if (dispatched > 0) {
        this.logger.log(`Sweep đã đưa lại ${dispatched} job batch vào queue`);
      }
    });
  }

  onApplicationBootstrap(): void {
    void this.queue
      .upsertRepeatingJob(WATERMARK_BATCH_DISPATCH_V1, BATCH_SWEEP_EVERY_MS)
      .catch((error: unknown) => {
        this.logger.error(
          `Không thể đăng ký ${WATERMARK_BATCH_DISPATCH_V1.jobName}: ${errorMessage(error)}`,
        );
      });
  }

  private async process(
    payload: Record<string, unknown>,
    context: BullMqJobContext,
  ): Promise<void> {
    try {
      const job = await this.processWatermarkJob.execute(
        String(payload.jobId),
        String(payload.shopDomain),
        { resumeProcessing: true },
      );
      if (job.status === "COMPLETED" && job.publishOnComplete) {
        await this.enqueueJob.execute({
          ...PUBLICATION_PUBLISH_V1,
          jobId: `publish_${job.id}`,
          payload: {
            watermarkJobId: job.id,
            shopDomain: job.shopDomain,
            // Rule tự publish: thay ảnh watermark cũ của app trên sản phẩm, và
            // bỏ qua nếu đã có job auto mới hơn cho sản phẩm (ảnh nguồn đã đổi).
            replacePrevious: true,
            onlyIfLatest: true,
          },
          maxAttempts: 5,
        });
      }
    } catch (error) {
      // Job còn lượt retry thì vẫn chiếm chỗ trong cửa sổ của batch.
      if (context.isFinalAttempt) await this.dispatchNext(payload);
      throw error;
    }
    await this.dispatchNext(payload);
  }

  private async dispatchNext(payload: Record<string, unknown>): Promise<void> {
    const batchId = typeof payload.batchId === "string" ? payload.batchId : "";
    if (!batchId) return;
    try {
      await this.dispatchBatch.execute(batchId);
    } catch (error) {
      // Không làm hỏng job watermark đã xong; sweep định kỳ sẽ bù lại.
      this.logger.error(`Không bù được job cho batch ${batchId}: ${errorMessage(error)}`);
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
