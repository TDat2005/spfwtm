import { ListProducts } from "./src/modules/catalog/application/ListProducts.ts";
import { ShopifyProductGateway } from "./src/modules/catalog/infrastructure/ShopifyProductGateway.ts";
import { createCatalogRouter } from "./src/modules/catalog/presentation/catalogRoutes.ts";
import { join } from "path";
import { readFileSync } from "fs";
import express from "express";
import { SyncCatalog } from "./src/modules/catalog/application/SyncCatalog.ts";
import { PrismaProductRepository } from "./src/modules/catalog/infrastructure/PrismaProductRepository.ts";
import { prisma } from "./src/shared/infrastructure/prisma.ts";
import serveStatic from "serve-static";
import type { Session } from "@shopify/shopify-api";
import shopify from "./shopify.js";
import productCreator from "./product-creator.js";
import PrivacyWebhookHandlers from "./privacy.js";
import { MediaService } from "./src/modules/media/application/MediaService.ts";
import { FetchRemoteImageDownloader } from "./src/modules/media/infrastructure/FetchRemoteImageDownloader.ts";
import { LocalMediaStorage } from "./src/modules/media/infrastructure/LocalMediaStorage.ts";
import { MediaWatermarkGateway } from "./src/modules/media/infrastructure/MediaWatermarkGateway.ts";
import { PrismaMediaAssetRepository } from "./src/modules/media/infrastructure/PrismaMediaAssetRepository.ts";
import { Sha256ContentHasher } from "./src/modules/media/infrastructure/Sha256ContentHasher.ts";
import { createMediaRouter } from "./src/modules/media/presentation/mediaRoutes.ts";
import { CreateWatermarkJob } from "./src/modules/watermark/application/CreateWatermarkJob.ts";
import { ListWatermarkJobs } from "./src/modules/watermark/application/ListWatermarkJobs.ts";
import { ProcessWatermarkJob } from "./src/modules/watermark/application/ProcessWatermarkJob.ts";
import { GetWatermarkJob } from "./src/modules/watermark/application/GetWatermarkJob.ts";
import { RetryWatermarkJob } from "./src/modules/watermark/application/RetryWatermarkJob.ts";
import { CancelWatermarkJob } from "./src/modules/watermark/application/CancelWatermarkJob.ts";
import { PrismaProductImageReader } from "./src/modules/watermark/infrastructure/PrismaProductImageReader.ts";
import { PrismaWatermarkJobRepository } from "./src/modules/watermark/infrastructure/PrismaWatermarkJobRepository.ts";
import { SharpWatermarkProcessor } from "./src/modules/watermark/infrastructure/SharpWatermarkProcessor.ts";
import { createWatermarkRouter } from "./src/modules/watermark/presentation/watermarkRoutes.ts";
import { ListPublishedMedia } from "./src/modules/shopify-publication/application/ListPublishedMedia.ts";
import { PublishWatermarkedImage } from "./src/modules/shopify-publication/application/PublishWatermarkedImage.ts";
import { RestoreOriginalImage } from "./src/modules/shopify-publication/application/RestoreOriginalImage.ts";
import { AdminGraphqlMediaGateway } from "./src/modules/shopify-publication/infrastructure/AdminGraphqlMediaGateway.ts";
import { PrismaPublishedMediaRepository } from "./src/modules/shopify-publication/infrastructure/PrismaPublishedMediaRepository.ts";
import { PrismaWatermarkResultReader } from "./src/modules/shopify-publication/infrastructure/PrismaWatermarkResultReader.ts";
import { createPublicationRouter } from "./src/modules/shopify-publication/presentation/publicationRoutes.ts";
import { EnqueueJob } from "./src/modules/jobs/application/EnqueueJob.ts";
import { BullMqJobQueue } from "./src/modules/jobs/infrastructure/BullMqJobQueue.ts";
import { BullMqWorker } from "./src/modules/jobs/infrastructure/BullMqWorker.ts";
import { redisRuntimeConfigFromEnv } from "./src/modules/jobs/infrastructure/RedisConnection.ts";
const PORT = parseInt(
  process.env.BACKEND_PORT || process.env.PORT || "3000",
  10
);

const STATIC_PATH =
  process.env.NODE_ENV === "production"
    ? `${process.cwd()}/frontend/dist`
    : `${process.cwd()}/frontend/`;

const app = express();
const productRepository = new PrismaProductRepository(prisma);
const mediaRepository = new PrismaMediaAssetRepository(prisma);
const mediaStorage = new LocalMediaStorage(
  join(process.cwd(), "storage", "media")
);
const publishedMediaRepository =
  new PrismaPublishedMediaRepository(prisma);

const watermarkResultReader =
  new PrismaWatermarkResultReader(
    prisma,
    mediaStorage,
  );

const listPublishedMedia =
  new ListPublishedMedia(
    publishedMediaRepository,
  );
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
const watermarkWorker = new BullMqWorker({
  queueName: redisConfig.queueName,
  connection: redisConfig.workerConnection,
  concurrency: redisConfig.concurrency,
  prefix: redisConfig.prefix,
});

watermarkWorker.registerHandler("WATERMARK_PROCESS", async (payload) => {
  const jobId = String(payload.jobId);
  const shopDomain = String(payload.shopDomain);
  await processWatermarkJob.execute(jobId, shopDomain, {
    resumeProcessing: true,
  });
});

watermarkWorker.start();
// Set up Shopify authentication and webhook handling
app.get(shopify.config.auth.path, shopify.auth.begin());
app.get(
  shopify.config.auth.callbackPath,
  shopify.auth.callback(),
  shopify.redirectToShopifyOrAppRoot()
);
app.post(
  shopify.config.webhooks.path,
  shopify.processWebhooks({ webhookHandlers: PrivacyWebhookHandlers })
);

// If you are adding routes outside of the /api path, remember to
// also add a proxy rule for them in web/frontend/vite.config.js

app.use("/api/*", shopify.validateAuthenticatedSession());

app.use(express.json());
app.use(
  "/api/catalog",
  createCatalogRouter({
    createListProducts: () => {
      return new ListProducts(productRepository);
    },

    createSyncCatalog: (session: Session) => {
      const productGateway = new ShopifyProductGateway(shopify, session);

      return new SyncCatalog(productGateway, productRepository);
    },
  })
);
app.use("/api/media", createMediaRouter(mediaService));
app.use(
  "/api/watermarks",
  createWatermarkRouter({
    createWatermarkJob,
    listWatermarkJobs,
    processWatermarkJob,
    getWatermarkJob,
    retryWatermarkJob,
    cancelWatermarkJob,
    enqueueJob,
  })
);
app.use(
  "/api/publications",
  createPublicationRouter({
    listPublishedMedia,

    createPublishWatermarkedImage: (
      session: Session,
    ) => {
      const shopifyMediaGateway =
        new AdminGraphqlMediaGateway(
          shopify,
          session,
        );

      return new PublishWatermarkedImage(
        watermarkResultReader,
        shopifyMediaGateway,
        publishedMediaRepository,
      );
    },

    createRestoreOriginalImage: (
      session: Session,
    ) => {
      const shopifyMediaGateway =
        new AdminGraphqlMediaGateway(
          shopify,
          session,
        );

      return new RestoreOriginalImage(
        publishedMediaRepository,
        shopifyMediaGateway,
      );
    },
  }),
);
app.get("/api/products/count", async (_req, res) => {
  const client = new shopify.api.clients.Graphql({
    session: res.locals.shopify.session,
  });

  const countData = await client.request(`
    query shopifyProductCount {
      productsCount {
        count
      }
    }
  `);

  res.status(200).send({
    count: countData.data.productsCount.count,
  });
});

app.post("/api/products", async (_req, res) => {
  let status = 200;
  let error: string | null = null;

  try {
    await productCreator(res.locals.shopify.session);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    console.log(`Failed to process products/create: ${message}`);
    status = 500;
    error = message;
  }
  res.status(status).send({ success: status === 200, error });
});

app.use(shopify.cspHeaders());
app.use(serveStatic(STATIC_PATH, { index: false }));

app.use("/*", shopify.ensureInstalledOnShop(), async (_req, res, _next) => {
  return res
    .status(200)
    .set("Content-Type", "text/html")
    .send(
      readFileSync(join(STATIC_PATH, "index.html"))
        .toString()
        .replace("%VITE_SHOPIFY_API_KEY%", process.env.SHOPIFY_API_KEY || "")
    );
});

const server = app.listen(PORT, () => {
  console.log(`Backend đang chạy tại port ${PORT}.`);
});

let isShuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`Nhận ${signal}, đang dừng ứng dụng an toàn...`);

  const closeHttpServer = new Promise<void>((resolve) => {
    server.close(() => resolve());
  });

  const results = await Promise.allSettled([
    closeHttpServer,
    watermarkWorker.stop(),
  ]);
  results.push(
    ...(await Promise.allSettled([jobQueue.close(), prisma.$disconnect()]))
  );

  const failed = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );
  if (failed) {
    console.error("Không thể dừng sạch toàn bộ tài nguyên:", failed.reason);
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
