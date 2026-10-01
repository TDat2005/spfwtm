import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type {
  CatalogSyncRepository,
  CatalogSyncState,
} from "../application/CatalogSyncPorts.ts";

/** Trạng thái sync lưu ngay trên bảng shops: mỗi shop chỉ có một sync tại một thời điểm. */
export class PrismaCatalogSyncRepository implements CatalogSyncRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getState(shopDomain: string): Promise<CatalogSyncState> {
    const shop = await this.prisma.shop.findUnique({
      where: { domain: shopDomain },
      select: {
        catalogSyncId: true,
        catalogSyncStatus: true,
        catalogSyncedCount: true,
        catalogSyncError: true,
        catalogSyncStartedAt: true,
        catalogSyncFinishedAt: true,
      },
    });

    return {
      syncId: shop?.catalogSyncId ?? null,
      status: shop?.catalogSyncStatus ?? "IDLE",
      syncedCount: shop?.catalogSyncedCount ?? 0,
      error: shop?.catalogSyncError ?? null,
      startedAt: shop?.catalogSyncStartedAt ?? null,
      finishedAt: shop?.catalogSyncFinishedAt ?? null,
    };
  }

  async tryStart(shopDomain: string, syncId: string, staleBefore: Date): Promise<boolean> {
    await this.prisma.shop.upsert({
      where: { domain: shopDomain },
      create: { domain: shopDomain },
      update: {},
    });

    const now = new Date();
    // Điều kiện nằm trong câu UPDATE nên hai request đồng thời chỉ một bên thắng.
    const { count } = await this.prisma.shop.updateMany({
      where: {
        domain: shopDomain,
        OR: [
          { catalogSyncStatus: { not: "RUNNING" } },
          { catalogSyncHeartbeatAt: null },
          { catalogSyncHeartbeatAt: { lt: staleBefore } },
        ],
      },
      data: {
        catalogSyncId: syncId,
        catalogSyncStatus: "RUNNING",
        catalogSyncPage: 0,
        catalogSyncedCount: 0,
        catalogSyncError: null,
        catalogSyncStartedAt: now,
        catalogSyncHeartbeatAt: now,
        catalogSyncFinishedAt: null,
      },
    });
    return count === 1;
  }

  async isActive(shopDomain: string, syncId: string): Promise<boolean> {
    const count = await this.prisma.shop.count({
      where: { domain: shopDomain, catalogSyncId: syncId, catalogSyncStatus: "RUNNING" },
    });
    return count === 1;
  }

  async recordPage(
    shopDomain: string,
    syncId: string,
    page: number,
    productCount: number,
  ): Promise<void> {
    await this.prisma.shop.updateMany({
      where: {
        domain: shopDomain,
        catalogSyncId: syncId,
        catalogSyncStatus: "RUNNING",
        catalogSyncPage: page - 1,
      },
      data: {
        catalogSyncPage: page,
        catalogSyncedCount: { increment: productCount },
        catalogSyncHeartbeatAt: new Date(),
      },
    });
  }

  async complete(shopDomain: string, syncId: string): Promise<void> {
    await this.finish(shopDomain, syncId, "COMPLETED", null);
  }

  async fail(shopDomain: string, syncId: string, error: string): Promise<void> {
    await this.finish(shopDomain, syncId, "FAILED", error);
  }

  private async finish(
    shopDomain: string,
    syncId: string,
    status: "COMPLETED" | "FAILED",
    error: string | null,
  ): Promise<void> {
    await this.prisma.shop.updateMany({
      where: { domain: shopDomain, catalogSyncId: syncId, catalogSyncStatus: "RUNNING" },
      data: {
        catalogSyncStatus: status,
        catalogSyncError: error,
        catalogSyncFinishedAt: new Date(),
      },
    });
  }
}
