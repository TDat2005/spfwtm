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
      // jobId cố định theo (sync, trang): nếu job trang trước retry sau khi đã
      // xếp trang kế, BullMQ bỏ qua bản trùng thay vì chạy hai lần.
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
