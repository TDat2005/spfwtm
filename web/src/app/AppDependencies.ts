import type { Session } from "@shopify/shopify-api";
import type { ListProducts } from "../modules/catalog/application/ListProducts.ts";
import type { SyncCatalog } from "../modules/catalog/application/SyncCatalog.ts";
import type { MediaService } from "../modules/media/application/MediaService.ts";
import type { CreateWatermarkJob } from "../modules/watermark/application/CreateWatermarkJob.ts";
import type { ListWatermarkJobs } from "../modules/watermark/application/ListWatermarkJobs.ts";
import type { ProcessWatermarkJob } from "../modules/watermark/application/ProcessWatermarkJob.ts";
import type { GetWatermarkJob } from "../modules/watermark/application/GetWatermarkJob.ts";
import type { RetryWatermarkJob } from "../modules/watermark/application/RetryWatermarkJob.ts";
import type { CancelWatermarkJob } from "../modules/watermark/application/CancelWatermarkJob.ts";
import type { CreateWatermarkBatch } from "../modules/watermark/application/CreateWatermarkBatch.ts";
import type { ListWatermarkBatches } from "../modules/watermark/application/ListWatermarkBatches.ts";
import type { CancelWatermarkBatch } from "../modules/watermark/application/CancelWatermarkBatch.ts";
import type { EnqueueJob } from "../modules/jobs/application/EnqueueJob.ts";
import type { ListPublishedMedia } from "../modules/shopify-publication/application/ListPublishedMedia.ts";
import type { PublishWatermarkedImage } from "../modules/shopify-publication/application/PublishWatermarkedImage.ts";
import type { RestoreOriginalImage } from "../modules/shopify-publication/application/RestoreOriginalImage.ts";

export const APP_DEPENDENCIES = Symbol("APP_DEPENDENCIES");

export interface AppDependencies {
  countProducts(session: Session): Promise<number>;
  createProduct(session: Session): Promise<void>;
  createListProducts(): ListProducts;
  createSyncCatalog(session: Session): SyncCatalog;
  mediaService: MediaService;
  createWatermarkJob: CreateWatermarkJob;
  listWatermarkJobs: ListWatermarkJobs;
  processWatermarkJob: ProcessWatermarkJob;
  getWatermarkJob: GetWatermarkJob;
  retryWatermarkJob: RetryWatermarkJob;
  cancelWatermarkJob: CancelWatermarkJob;
  enqueueJob: EnqueueJob;
  createWatermarkBatch: CreateWatermarkBatch;
  listWatermarkBatches: ListWatermarkBatches;
  cancelWatermarkBatch: CancelWatermarkBatch;
  listPublishedMedia: ListPublishedMedia;
  createPublishWatermarkedImage(session: Session): PublishWatermarkedImage;
  createRestoreOriginalImage(session: Session): RestoreOriginalImage;
}
