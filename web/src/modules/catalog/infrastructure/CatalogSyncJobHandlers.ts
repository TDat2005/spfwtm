import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { CATALOG_SYNC_PAGE_V1, assertJobVersion } from "../../jobs/domain/JobDefinitions.ts";
import { BullMqWorker } from "../../jobs/infrastructure/BullMqWorker.ts";
import type { CatalogSyncRepository } from "../application/CatalogSyncPorts.ts";
import { SyncCatalogPage } from "../application/SyncCatalogPage.ts";
import { CATALOG_SYNC_REPOSITORY } from "../tokens.ts";

@Injectable()
export class CatalogSyncJobHandlers implements OnModuleInit {
  private readonly logger = new Logger("CatalogSync");

  constructor(
    @Inject(BullMqWorker) private readonly worker: BullMqWorker,
    @Inject(SyncCatalogPage) private readonly syncCatalogPage: SyncCatalogPage,
    @Inject(CATALOG_SYNC_REPOSITORY) private readonly syncs: CatalogSyncRepository,
  ) {}

  onModuleInit(): void {
    this.worker.registerHandler(CATALOG_SYNC_PAGE_V1.jobName, async (payload, context) => {
      const input = {
        shopDomain: String(payload.shopDomain ?? ""),
        syncId: String(payload.syncId ?? ""),
        page: Number(payload.page),
        cursor: typeof payload.cursor === "string" ? payload.cursor : null,
      };

      // Mọi lỗi (kể cả payload sai) đều phải kết thúc sync, không thì shop kẹt ở RUNNING.
      try {
        assertJobVersion(payload, CATALOG_SYNC_PAGE_V1);
        if (!input.shopDomain || !input.syncId || !Number.isInteger(input.page) || input.page < 1) {
          throw new Error("CATALOG_SYNC_PAGE_V1 thiếu shopDomain, syncId hoặc page");
        }
        await this.syncCatalogPage.execute(input);
      } catch (error) {
        if (context.isFinalAttempt && input.shopDomain && input.syncId) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(`Sync ${input.syncId} của ${input.shopDomain} thất bại: ${message}`);
          await this.syncs.fail(input.shopDomain, input.syncId, message);
        }
        throw error;
      }
    });
  }
}
