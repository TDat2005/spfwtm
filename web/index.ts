import { ListProducts } from "./src/modules/catalog/application/ListProducts.ts";
import { ShopifyProductGateway } from "./src/modules/catalog/infrastructure/ShopifyProductGateway.ts";
import { join } from "path";
import { createHash } from "node:crypto";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Express } from "express";
import { AppModule } from "./src/app/AppModule.ts";
import { SyncCatalog } from "./src/modules/catalog/application/SyncCatalog.ts";
import { PrismaProductRepository } from "./src/modules/catalog/infrastructure/PrismaProductRepository.ts";
import { prisma } from "./src/shared/infrastructure/prisma.ts";
import serveStatic from "serve-static";
import type { Session } from "@shopify/shopify-api";
import shopify, { SHOPIFY_API_VERSION } from "./shopify.js";
import productCreator from "./product-creator.js";
import PrivacyWebhookHandlers from "./privacy.js";
import { MediaService } from "./src/modules/media/application/MediaService.ts";
import { FetchRemoteImageDownloader } from "./src/modules/media/infrastructure/FetchRemoteImageDownloader.ts";
import { LocalMediaStorage } from "./src/modules/media/infrastructure/LocalMediaStorage.ts";
import { MediaWatermarkGateway } from "./src/modules/media/infrastructure/MediaWatermarkGateway.ts";
import { PrismaMediaAssetRepository } from "./src/modules/media/infrastructure/PrismaMediaAssetRepository.ts";
import { Sha256ContentHasher } from "./src/modules/media/infrastructure/Sha256ContentHasher.ts";
import { CreateWatermarkJob } from "./src/modules/watermark/application/CreateWatermarkJob.ts";
import { ListWatermarkJobs } from "./src/modules/watermark/application/ListWatermarkJobs.ts";
import { ProcessWatermarkJob } from "./src/modules/watermark/application/ProcessWatermarkJob.ts";
import { GetWatermarkJob } from "./src/modules/watermark/application/GetWatermarkJob.ts";
import { RetryWatermarkJob } from "./src/modules/watermark/application/RetryWatermarkJob.ts";
import { CancelWatermarkJob } from "./src/modules/watermark/application/CancelWatermarkJob.ts";
import { CreateWatermarkBatch } from "./src/modules/watermark/application/CreateWatermarkBatch.ts";
import { ListWatermarkBatches } from "./src/modules/watermark/application/ListWatermarkBatches.ts";
import { CancelWatermarkBatch } from "./src/modules/watermark/application/CancelWatermarkBatch.ts";
import { PrismaProductImageReader } from "./src/modules/watermark/infrastructure/PrismaProductImageReader.ts";
import { PrismaWatermarkJobRepository } from "./src/modules/watermark/infrastructure/PrismaWatermarkJobRepository.ts";
import { PrismaWatermarkBatchRepository } from "./src/modules/watermark/infrastructure/PrismaWatermarkBatchRepository.ts";
import { SharpWatermarkProcessor } from "./src/modules/watermark/infrastructure/SharpWatermarkProcessor.ts";
import { ListPublishedMedia } from "./src/modules/shopify-publication/application/ListPublishedMedia.ts";
import { PublishWatermarkedImage } from "./src/modules/shopify-publication/application/PublishWatermarkedImage.ts";
import { RestoreOriginalImage } from "./src/modules/shopify-publication/application/RestoreOriginalImage.ts";
import { AdminGraphqlMediaGateway } from "./src/modules/shopify-publication/infrastructure/AdminGraphqlMediaGateway.ts";
import { PrismaPublishedMediaRepository } from "./src/modules/shopify-publication/infrastructure/PrismaPublishedMediaRepository.ts";
import { PrismaWatermarkResultReader } from "./src/modules/shopify-publication/infrastructure/PrismaWatermarkResultReader.ts";
import { EnqueueJob } from "./src/modules/jobs/application/EnqueueJob.ts";
import { BullMqJobQueue } from "./src/modules/jobs/infrastructure/BullMqJobQueue.ts";
import { BullMqWorker } from "./src/modules/jobs/infrastructure/BullMqWorker.ts";
import { redisRuntimeConfigFromEnv } from "./src/modules/jobs/infrastructure/RedisConnection.ts";
import {
  PRODUCT_MEDIA_RECONCILE_V1,
  CATALOG_RECONCILE_V1,
  WATERMARK_PROCESS_V1,
  assertJobVersion,
} from "./src/modules/jobs/domain/JobDefinitions.ts";
import { ReceiveProductWebhook } from "./src/modules/product-media-sync/application/ReceiveProductWebhook.ts";
import { ReconcileProductMedia } from "./src/modules/product-media-sync/application/ReconcileProductMedia.ts";
import { BullMqProductReconcileQueue } from "./src/modules/product-media-sync/infrastructure/BullMqProductReconcileQueue.ts";
import { PrismaPublicationAttemptRepository } from "./src/modules/product-media-sync/infrastructure/PrismaPublicationAttemptRepository.ts";
import { PrismaWebhookInboxRepository } from "./src/modules/product-media-sync/infrastructure/PrismaWebhookInboxRepository.ts";
import { createProductWebhookHandlers } from "./src/modules/product-media-sync/infrastructure/ProductWebhookHandlers.ts";
import { ShopifyProductMediaGateway } from "./src/modules/product-media-sync/infrastructure/ShopifyProductMediaGateway.ts";
const PORT = parseInt(
  process.env.BACKEND_PORT || process.env.PORT || "3000",
  10
);

const STATIC_PATH =
  process.env.NODE_ENV === "production"
    ? `${process.cwd()}/frontend/dist`
    : `${process.cwd()}/frontend/`;

const productRepository = new PrismaProductRepository(prisma);
const mediaRepository = new PrismaMediaAssetRepository(prisma);
const mediaStorage = new LocalMediaStorage(
  join(process.cwd(), "storage", "media")
);
const publishedMediaRepository = new PrismaPublishedMediaRepository(prisma);

const watermarkResultReader = new PrismaWatermarkResultReader(
  prisma,
  mediaStorage
);

const listPublishedMedia = new ListPublishedMedia(publishedMediaRepository);
const mediaService = new MediaService(
  new FetchRemoteImageDownloader(),
  mediaStorage,
  new Sha256ContentHasher(),
  mediaRepository
);
const watermarkRepository = new PrismaWatermarkJobRepository(prisma);
const watermarkMedia = new MediaWatermarkGateway(mediaService);
const createWatermarkJob = new CreateWatermarkJob(
  watermarkRepository,
  new PrismaProductImageReader(prisma)
);
const listWatermarkJobs = new ListWatermarkJobs(watermarkRepository);
const getWatermarkJob = new GetWatermarkJob(watermarkRepository);
const retryWatermarkJob = new RetryWatermarkJob(watermarkRepository);
const cancelWatermarkJob = new CancelWatermarkJob(watermarkRepository);
const processWatermarkJob = new ProcessWatermarkJob(
  watermarkRepository,
  watermarkMedia,
  new SharpWatermarkProcessor()
);

const redisConfig = redisRuntimeConfigFromEnv();
const jobQueue = new BullMqJobQueue({
  queueName: redisConfig.queueName,
  connection: redisConfig.producerConnection,
  prefix: redisConfig.prefix,
});
const enqueueJob = new EnqueueJob(jobQueue);
const watermarkBatchRepository = new PrismaWatermarkBatchRepository(prisma);
const createWatermarkBatch = new CreateWatermarkBatch(
  watermarkBatchRepository,
  enqueueJob
);
const listWatermarkBatches = new ListWatermarkBatches(watermarkBatchRepository);
const cancelWatermarkBatch = new CancelWatermarkBatch(watermarkBatchRepository);
const backgroundWorker = new BullMqWorker({
  queueName: redisConfig.queueName,
  connection: redisConfig.workerConnection,
  concurrency: redisConfig.concurrency,
  prefix: redisConfig.prefix,
});
const webhookInboxRepository = new PrismaWebhookInboxRepository(prisma);
const publicationAttemptRepository = new PrismaPublicationAttemptRepository(
  prisma
);
const receiveProductWebhook = new ReceiveProductWebhook(
  webhookInboxRepository,
  new BullMqProductReconcileQueue(enqueueJob)
);

async function processWatermarkPayload(payload: Record<string, unknown>) {
  const jobId = String(payload.jobId);
  const shopDomain = String(payload.shopDomain);
  await processWatermarkJob.execute(jobId, shopDomain, {
    resumeProcessing: true,
  });
}

backgroundWorker.registerHandler(
  WATERMARK_PROCESS_V1.jobName,
  async (payload) => {
    assertJobVersion(payload, WATERMARK_PROCESS_V1);
    await processWatermarkPayload(payload);
  }
);

// Tương thích với job đã nằm trong queue trước khi tên V1 được triển khai.
backgroundWorker.registerHandler("WATERMARK_PROCESS", processWatermarkPayload);

backgroundWorker.registerHandler(
  PRODUCT_MEDIA_RECONCILE_V1.jobName,
  async (payload) => {
    assertJobVersion(payload, PRODUCT_MEDIA_RECONCILE_V1);
    const webhookId = String(payload.webhookId ?? "");
    const shopDomain = String(payload.shopDomain ?? "");
    if (!webhookId || !shopDomain) {
      throw new Error(
        "PRODUCT_MEDIA_RECONCILE_V1 thiếu webhookId hoặc shopDomain"
      );
    }

    const offlineSessionId = shopify.api.session.getOfflineId(shopDomain);
    const session = await shopify.config.sessionStorage.loadSession(
      offlineSessionId
    );
    if (!session) {
      throw new Error(`Không tìm thấy offline session cho ${shopDomain}`);
    }

    const reconcile = new ReconcileProductMedia(
      webhookInboxRepository,
      new ShopifyProductMediaGateway(shopify, session)
    );
    await reconcile.execute(webhookId);
  }
);

backgroundWorker.registerHandler(
  CATALOG_RECONCILE_V1.jobName,
  async (payload) => {
    assertJobVersion(payload, CATALOG_RECONCILE_V1);
    const changedSince = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const candidates =
      await webhookInboxRepository.listReconciliationCandidates(changedSince);
    const day = new Date().toISOString().slice(0, 10);

    for (const candidate of candidates) {
      const key = createHash("sha256")
        .update(`${candidate.shopDomain}\0${candidate.productId}`)
        .digest("hex")
        .slice(0, 32);
      await receiveProductWebhook.execute({
        webhookId: `catalog-reconcile-${day}-${key}`,
        shopDomain: candidate.shopDomain,
        topic: "CATALOG_RECONCILE",
        apiVersion: SHOPIFY_API_VERSION,
        body: JSON.stringify({
          admin_graphql_api_id: candidate.productId,
          updated_at: candidate.updatedAt.toISOString(),
        }),
      });
    }
  }
);

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.register({
      countProducts: async (session: Session) => {
        const client = new shopify.api.clients.Graphql({ session });
        const result = await client.request<{ productsCount: { count: number } }>(`
          query shopifyProductCount {
            productsCount { count }
          }
        `);
        if (!result.data) throw new Error("Không nhận được productsCount từ Shopify");
        return result.data.productsCount.count;
      },
      createProduct: productCreator,
      createListProducts: () => new ListProducts(productRepository),
      createSyncCatalog: (session: Session) =>
        new SyncCatalog(new ShopifyProductGateway(shopify, session), productRepository),
      mediaService,
      createWatermarkJob,
      listWatermarkJobs,
      processWatermarkJob,
      getWatermarkJob,
      retryWatermarkJob,
      cancelWatermarkJob,
      enqueueJob,
      createWatermarkBatch,
      listWatermarkBatches,
      cancelWatermarkBatch,
      listPublishedMedia,
      createPublishWatermarkedImage: (session: Session) =>
        new PublishWatermarkedImage(
          watermarkResultReader,
          new AdminGraphqlMediaGateway(shopify, session),
          publishedMediaRepository,
          publicationAttemptRepository,
        ),
      createRestoreOriginalImage: (session: Session) =>
        new RestoreOriginalImage(
          publishedMediaRepository,
          new AdminGraphqlMediaGateway(shopify, session),
        ),
    }),
  );
  const http = app.getHttpAdapter().getInstance() as Express;

  // Shopify's Express middleware must see OAuth and raw webhook requests before
  // Nest registers its JSON body parser and application controllers.
  http.get(shopify.config.auth.path, shopify.auth.begin());
  http.get(
    shopify.config.auth.callbackPath,
    shopify.auth.callback(),
    shopify.redirectToShopifyOrAppRoot(),
  );
  http.post(
    shopify.config.webhooks.path,
    shopify.processWebhooks({
      webhookHandlers: {
        ...PrivacyWebhookHandlers,
        ...createProductWebhookHandlers(receiveProductWebhook, SHOPIFY_API_VERSION),
      },
    }),
  );
  http.use('/api', shopify.validateAuthenticatedSession());
  http.use(shopify.cspHeaders());
  http.use(serveStatic(STATIC_PATH, { index: false }));
  const ensureInstalled = shopify.ensureInstalledOnShop();
  http.use((request, response, next) => {
    if (request.path === '/api' || request.path.startsWith('/api/')) return next();
    return ensureInstalled(request, response, next);
  });

  await app.init();
  await app.listen(PORT);
  console.log(`Backend đang chạy tại port ${PORT}.`);

  void jobQueue
    .upsertDailyJob(
      CATALOG_RECONCILE_V1,
      process.env.CATALOG_RECONCILE_CRON || '0 3 * * *',
      process.env.CATALOG_RECONCILE_TIMEZONE || 'Asia/Ho_Chi_Minh',
    )
    .catch((error: unknown) => {
      console.error(
        '[BullMQ] Không thể đăng ký CATALOG_RECONCILE_V1:',
        error instanceof Error ? error.message : error,
      );
    });
  backgroundWorker.start();

  let isShuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`Nhận ${signal}, đang dừng ứng dụng an toàn...`);
    const results = await Promise.allSettled([app.close(), backgroundWorker.stop()]);
    results.push(...(await Promise.allSettled([jobQueue.close(), prisma.$disconnect()])));
    const failed = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failed) {
      console.error('Không thể dừng sạch toàn bộ tài nguyên:', failed.reason);
      process.exitCode = 1;
    }
  }

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

void bootstrap().catch(async (error: unknown) => {
  console.error('Không thể khởi động backend:', error);
  await Promise.allSettled([backgroundWorker.stop(), jobQueue.close(), prisma.$disconnect()]);
  process.exitCode = 1;
});
