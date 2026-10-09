import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleInit,
} from "@nestjs/common";
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import { PRISMA_CLIENT } from "../../../shared/nest/tokens.ts";
import { EnqueueJob } from "../../jobs/application/EnqueueJob.ts";
import { batchPublishJob } from "../../shopify-publication/application/BatchPublishJob.ts";
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
import { RecoverWatermarkJobs } from "../application/RecoverWatermarkJobs.ts";

const BATCH_SWEEP_EVERY_MS = 60_000;
const WATERMARK_STUCK_AFTER_MS = 5 * 60 * 1000;

@Injectable()
export class WatermarkJobHandlers implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger("WatermarkJobs");

  constructor(
    @Inject(BullMqWorker) private readonly worker: BullMqWorker,
    @Inject(BullMqJobQueue) private readonly queue: BullMqJobQueue,
    @Inject(ProcessWatermarkJob) private readonly processWatermarkJob: ProcessWatermarkJob,
    @Inject(DispatchWatermarkBatch) private readonly dispatchBatch: DispatchWatermarkBatch,
    @Inject(RecoverWatermarkJobs) private readonly recoverJobs: RecoverWatermarkJobs,
    @Inject(EnqueueJob) private readonly enqueueJob: EnqueueJob,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  onModuleInit(): void {
    // Một ảnh chỉ mất vài giây; 5 phút chưa xong thì tiến trình đã đơ.
    const watchdog = { stuckAfterMs: WATERMARK_STUCK_AFTER_MS };
    this.worker.registerHandler(WATERMARK_PROCESS_V1.jobName, async (payload, context) => {
      assertJobVersion(payload, WATERMARK_PROCESS_V1);
      await this.process(payload, context);
    }, watchdog);

    this.worker.registerHandler("WATERMARK_PROCESS", (payload, context) =>
      this.process(payload, context),
    watchdog);

    this.worker.registerHandler(WATERMARK_BATCH_DISPATCH_V1.jobName, async (payload) => {
      assertJobVersion(payload, WATERMARK_BATCH_DISPATCH_V1);
      // Đối chiếu với queue trước: job bị đánh FAILED nhả chỗ để sweep bù ngay.
      const recovered = await this.recoverJobs.execute();
      if (recovered.requeuedJobs > 0) {
        this.logger.warn(`Đưa lại ${recovered.requeuedJobs} job watermark bị mất khỏi queue`);
      }
      if (recovered.failedJobs > 0) {
        this.logger.warn(`Đánh thất bại ${recovered.failedJobs} job watermark bị worker bỏ dở`);
      }
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
        { resumeProcessing: true, finalAttempt: context.isFinalAttempt },
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
      } else if (job.status === "COMPLETED" && (await this.batchAwaitsPublish(job.id))) {
        // Merchant đã bấm "Publish tất cả" khi job này còn đang chạy.
        await this.enqueueJob.execute(batchPublishJob(job.id, job.shopDomain));
      }
    } catch (error) {
      // Job còn lượt retry vẫn PROCESSING nên vẫn chiếm chỗ trong cửa sổ của shop.
      if (context.isFinalAttempt) await this.dispatchNext(payload);
      throw error;
    }
    await this.dispatchNext(payload);
  }

  /**
   * Đọc lại từ DB sau khi job đã lưu COMPLETED. Nút "Publish tất cả" ghi yêu cầu
   * trước rồi mới đọc job đã xong, nên mỗi job hoặc được nút đó đưa vào queue,
   * hoặc thấy yêu cầu ở đây; không job nào bị sót.
   */
  private async batchAwaitsPublish(watermarkJobId: string): Promise<boolean> {
    const row = await this.prisma.watermarkJob.findUnique({
      where: { id: watermarkJobId },
      select: {
        publishedMedia: { select: { id: true } },
        batch: { select: { publishRequestedAt: true } },
      },
    });
    return Boolean(row?.batch?.publishRequestedAt) && !row?.publishedMedia;
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
