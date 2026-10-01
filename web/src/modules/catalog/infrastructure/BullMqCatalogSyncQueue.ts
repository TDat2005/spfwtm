import type { EnqueueJob } from "../../jobs/application/EnqueueJob.ts";
import { CATALOG_SYNC_PAGE_V1 } from "../../jobs/domain/JobDefinitions.ts";
import type {
  CatalogSyncPageInput,
  CatalogSyncQueue,
} from "../application/CatalogSyncPorts.ts";

export class BullMqCatalogSyncQueue implements CatalogSyncQueue {
  constructor(private readonly enqueueJob: EnqueueJob) {}

  async enqueuePage(input: CatalogSyncPageInput): Promise<void> {
    await this.enqueueJob.execute({
      ...CATALOG_SYNC_PAGE_V1,
      jobId: `catalog-sync-${input.syncId}-${input.page}`,
      payload: {
        shopDomain: input.shopDomain,
        syncId: input.syncId,
        page: input.page,
        cursor: input.cursor,
      },
      maxAttempts: 5,
    });
  }
}
