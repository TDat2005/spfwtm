import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { EnqueueJob } from "../../jobs/application/EnqueueJob.ts";
import {
  AUTO_WATERMARK_APPLY_V1,
  JOB_PRIORITY,
  PUBLICATION_RESTORE_V1,
  WATERMARK_PROCESS_V1,
} from "../../jobs/domain/JobDefinitions.ts";
import type { DispatchWatermarkBatch } from "../../watermark/application/DispatchWatermarkBatch.ts";
import type { WatermarkDesign } from "../../watermark/domain/WatermarkDesign.ts";
import {
  readWatermarkDesign,
  saveWatermarkDesign,
} from "../../watermark/infrastructure/PrismaWatermarkDesigns.ts";
import type {
  AutoWatermarkApplyQueue,
  AutoWatermarkJobQueue,
  AutoWatermarkRestoreQueue,
  WatermarkDesignStore,
} from "../application/AutoWatermarkPorts.ts";

export class BullMqAutoWatermarkJobQueue implements AutoWatermarkJobQueue {
  constructor(
    private readonly enqueue: EnqueueJob,
    private readonly dispatcher: Pick<DispatchWatermarkBatch, "execute">,
  ) {}

  async enqueueJob(jobId: string, shopDomain: string): Promise<void> {
    // Một sản phẩm vừa được tạo/đổi ảnh: lane interactive, nhường job merchant bấm tay.
    await this.enqueue.execute({
      ...WATERMARK_PROCESS_V1,
      jobId: `wm_${jobId}`,
      priority: JOB_PRIORITY.HIGH,
      payload: { jobId, shopDomain },
    });
  }

  async dispatchBatch(batchId: string): Promise<void> {
    await this.dispatcher.execute(batchId);
  }
}

export class BullMqAutoWatermarkApplyQueue implements AutoWatermarkApplyQueue {
  constructor(private readonly enqueue: EnqueueJob) {}

  async requestApply(input: {
    shopDomain: string;
    trigger: "SYNC" | "MANUAL";
    ruleId?: string;
  }): Promise<void> {
    await this.enqueue.execute({
      ...AUTO_WATERMARK_APPLY_V1,
      // Bấm "Áp dụng" nhiều lần khi lượt trước còn chờ thì chỉ chạy một lần.
      jobId: `autowm-apply-${input.ruleId ?? safeKey(input.shopDomain)}`,
      payload: input,
      removeOnComplete: true,
    });
  }
}

export class BullMqAutoWatermarkRestoreQueue implements AutoWatermarkRestoreQueue {
  constructor(private readonly enqueue: EnqueueJob) {}

  async requestRestore(input: { shopDomain: string; watermarkJobIds: string[] }): Promise<void> {
    await this.enqueue.executeMany(
      input.watermarkJobIds.map((watermarkJobId) => ({
        ...PUBLICATION_RESTORE_V1,
        jobId: `restore_${watermarkJobId}`,
        payload: { watermarkJobId, shopDomain: input.shopDomain },
        maxAttempts: 5,
        removeOnComplete: true,
      }))
    );
  }
}

export class PrismaWatermarkDesignStore implements WatermarkDesignStore {
  constructor(private readonly prisma: PrismaClient) {}

  async save(shopDomain: string, design: WatermarkDesign): Promise<string> {
    const shop = await this.prisma.shop.findUnique({
      where: { domain: shopDomain },
      select: { id: true },
    });
    if (!shop) throw new Error("Shop chưa đồng bộ catalog");
    return saveWatermarkDesign(this.prisma, shop.id, design);
  }

  async findByIds(ids: string[]): Promise<Map<string, WatermarkDesign>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.watermarkDesign.findMany({
      where: { id: { in: ids } },
      select: { id: true, layers: true },
    });
    return new Map(rows.map((row) => [row.id, readWatermarkDesign(row)]));
  }
}

export function safeKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}
