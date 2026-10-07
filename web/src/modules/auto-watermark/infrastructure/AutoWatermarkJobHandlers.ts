import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleInit,
} from "@nestjs/common";
import {
  AUTO_WATERMARK_APPLY_V1,
  AUTO_WATERMARK_EVALUATE_V1,
  AUTO_WATERMARK_SYNC_V1,
  assertJobVersion,
} from "../../jobs/domain/JobDefinitions.ts";
import { BullMqJobQueue } from "../../jobs/infrastructure/BullMqJobQueue.ts";
import { BullMqWorker } from "../../jobs/infrastructure/BullMqWorker.ts";
import { ApplyAutoWatermarkRules } from "../application/ApplyAutoWatermarkRules.ts";
import { EvaluateProductRules } from "../application/EvaluateProductRules.ts";
import { AUTO_WATERMARK_APPLY_QUEUE, AUTO_WATERMARK_RULES } from "../tokens.ts";
import type {
  AutoWatermarkApplyQueue,
  AutoWatermarkRuleRepository,
} from "../application/AutoWatermarkPorts.ts";

@Injectable()
export class AutoWatermarkJobHandlers implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger("AutoWatermark");

  constructor(
    @Inject(BullMqWorker) private readonly worker: BullMqWorker,
    @Inject(BullMqJobQueue) private readonly queue: BullMqJobQueue,
    @Inject(EvaluateProductRules) private readonly evaluate: EvaluateProductRules,
    @Inject(ApplyAutoWatermarkRules) private readonly apply: ApplyAutoWatermarkRules,
    @Inject(AUTO_WATERMARK_RULES) private readonly rules: AutoWatermarkRuleRepository,
    @Inject(AUTO_WATERMARK_APPLY_QUEUE) private readonly applyQueue: AutoWatermarkApplyQueue,
  ) {}

  onModuleInit(): void {
    this.worker.registerHandler(AUTO_WATERMARK_EVALUATE_V1.jobName, async (payload) => {
      assertJobVersion(payload, AUTO_WATERMARK_EVALUATE_V1);
      const trigger = payload.trigger;
      if (trigger !== "NEW_PRODUCT" && trigger !== "PRIMARY_CHANGED") {
        throw new Error(`AUTO_WATERMARK_EVALUATE_V1: trigger không hợp lệ (${String(trigger)})`);
      }
      const result = await this.evaluate.execute({
        shopDomain: requiredString(payload.shopDomain, "shopDomain"),
        productId: requiredString(payload.productId, "productId"),
        trigger,
      });
      if (result.outcome === "CREATED") {
        this.logger.log(`Rule ${result.ruleId} tạo job ${result.jobId} cho ${String(payload.productId)}`);
      }
    });

    this.worker.registerHandler(AUTO_WATERMARK_APPLY_V1.jobName, async (payload) => {
      assertJobVersion(payload, AUTO_WATERMARK_APPLY_V1);
      const shopDomain = requiredString(payload.shopDomain, "shopDomain");
      const summaries =
        payload.trigger === "MANUAL"
          ? await this.apply.execute({
              shopDomain,
              trigger: "MANUAL",
              ruleId: requiredString(payload.ruleId, "ruleId"),
            })
          : await this.apply.execute({ shopDomain, trigger: "SYNC" });
      for (const summary of summaries) {
        this.logger.log(
          `${shopDomain} · rule "${summary.ruleName}": ${summary.createdJobs}/${summary.ownedProducts} sản phẩm cần đóng dấu` +
            (summary.collectionMissing ? " (collection không còn tồn tại)" : ""),
        );
      }
    });

    this.worker.registerHandler(AUTO_WATERMARK_SYNC_V1.jobName, async (payload) => {
      assertJobVersion(payload, AUTO_WATERMARK_SYNC_V1);
      for (const shopDomain of await this.rules.listShopsWithSyncRules()) {
        await this.applyQueue.requestApply({ shopDomain, trigger: "SYNC" });
      }
    });
  }

  onApplicationBootstrap(): void {
    void this.queue
      .upsertDailyJob(
        AUTO_WATERMARK_SYNC_V1,
        process.env.AUTO_WATERMARK_SYNC_CRON || "30 3 * * *",
        process.env.AUTO_WATERMARK_SYNC_TIMEZONE || "Asia/Ho_Chi_Minh",
      )
      .catch((error: unknown) => {
        this.logger.error(
          `Không thể đăng ký ${AUTO_WATERMARK_SYNC_V1.jobName}: ${error instanceof Error ? error.message : error}`,
        );
      });
  }
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Job auto-watermark thiếu ${name}`);
  }
  return value;
}
