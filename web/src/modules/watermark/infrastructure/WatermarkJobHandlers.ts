import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { WATERMARK_PROCESS_V1, assertJobVersion } from "../../jobs/domain/JobDefinitions.ts";
import { BullMqWorker } from "../../jobs/infrastructure/BullMqWorker.ts";
import { ProcessWatermarkJob } from "../application/ProcessWatermarkJob.ts";

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

    this.worker.registerHandler("WATERMARK_PROCESS", (payload) => this.process(payload));
  }

  private async process(payload: Record<string, unknown>): Promise<void> {
    await this.processWatermarkJob.execute(String(payload.jobId), String(payload.shopDomain), {
      resumeProcessing: true,
    });
  }
}
