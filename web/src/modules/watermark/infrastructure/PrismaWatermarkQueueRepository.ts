import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type {
  ProcessingJobRecord,
  QueuedJobRecord,
  WatermarkEnqueueRepository,
  WatermarkRecoveryRepository,
} from "../application/WatermarkQueuePorts.ts";

/** Trạng thái vào queue của job watermark (`enqueuedAt`) và việc đối chiếu với queue. */
export class PrismaWatermarkQueueRepository
  implements WatermarkEnqueueRepository, WatermarkRecoveryRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async markEnqueued(
    jobId: string,
    at: Date
  ): Promise<{ batchId: string | null } | null> {
    const { count } = await this.prisma.watermarkJob.updateMany({
      where: { id: jobId, status: "PENDING" },
      data: { enqueuedAt: at },
    });
    if (count === 0) return null;
    const job = await this.prisma.watermarkJob.findUnique({
      where: { id: jobId },
      select: { batchId: true },
    });
    return { batchId: job?.batchId ?? null };
  }

  async listQueuedBefore(before: Date, limit: number): Promise<QueuedJobRecord[]> {
    const rows = await this.prisma.watermarkJob.findMany({
      where: { status: "PENDING", enqueuedAt: { lt: before } },
      orderBy: { enqueuedAt: "asc" },
      take: limit,
      select: {
        id: true,
        batchId: true,
        enqueuedAt: true,
        shop: { select: { domain: true } },
        batch: { select: { totalJobs: true } },
      },
    });
    return rows.flatMap((row) =>
      row.enqueuedAt
        ? [
            {
              id: row.id,
              shopDomain: row.shop.domain,
              batchId: row.batchId,
              batchTotalJobs: row.batch?.totalJobs ?? null,
              enqueuedAt: row.enqueuedAt,
            },
          ]
        : []
    );
  }

  async touchQueued(jobId: string, seenEnqueuedAt: Date, at: Date): Promise<boolean> {
    const { count } = await this.prisma.watermarkJob.updateMany({
      where: { id: jobId, status: "PENDING", enqueuedAt: seenEnqueuedAt },
      data: { enqueuedAt: at },
    });
    return count === 1;
  }

  async listProcessingBefore(
    before: Date,
    limit: number
  ): Promise<ProcessingJobRecord[]> {
    return this.prisma.watermarkJob.findMany({
      where: { status: "PROCESSING", updatedAt: { lt: before } },
      orderBy: { updatedAt: "asc" },
      take: limit,
      select: { id: true, updatedAt: true },
    });
  }

  async failProcessing(
    jobId: string,
    seenUpdatedAt: Date,
    message: string
  ): Promise<boolean> {
    const { count } = await this.prisma.watermarkJob.updateMany({
      where: { id: jobId, status: "PROCESSING", updatedAt: seenUpdatedAt },
      data: { status: "FAILED", errorMessage: message },
    });
    return count === 1;
  }
}
