import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { WATERMARK_PROCESS_V1, assertJobVersion } from "../../jobs/domain/JobDefinitions.ts";
import { BullMqWorker } from "../../jobs/infrastructure/BullMqWorker.ts";
import { ProcessWatermarkJob } from "../application/ProcessWatermarkJob.ts";

/** Đăng ký handler xử lý job watermark với BullMQ worker khi module khởi tạo. */
@Injectable()
export class WatermarkJobHandlers implements OnModuleInit {
  constructor(
    @Inject(BullMqWorker) private readonly worker: BullMqWorker,
    @Inject(ProcessWatermarkJob) private readonly processWatermarkJob: ProcessWatermarkJob,
  ) {}

  onModuleInit(): void {
    this.worker.registerHandler(WATERMARK_PROCESS_V1.jobName, async (payload) => {
      assertJobVersion(payload, WATERMARK_PROCESS_V1);
      await this.process(payload);
    });

    // Tương thích với job đã nằm trong queue trước khi tên V1 được triển khai.
    this.worker.registerHandler("WATERMARK_PROCESS", (payload) => this.process(payload));
  }

  private async process(payload: Record<string, unknown>): Promise<void> {
    await this.processWatermarkJob.execute(String(payload.jobId), String(payload.shopDomain), {
      resumeProcessing: true,
    });
  }
}
