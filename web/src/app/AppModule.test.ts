import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { AddressInfo } from "node:net";
import type { Express, NextFunction, Request, Response } from "express";
import { CatalogController } from "../modules/catalog/presentation/CatalogController.ts";
import { ListProducts } from "../modules/catalog/application/ListProducts.ts";
import { ListProductTypes } from "../modules/catalog/application/ListProductTypes.ts";
import { StartCatalogSync } from "../modules/catalog/application/StartCatalogSync.ts";
import { GetCatalogSyncStatus } from "../modules/catalog/application/GetCatalogSyncStatus.ts";
import { MediaController } from "../modules/media/presentation/MediaController.ts";
import { MediaService } from "../modules/media/application/MediaService.ts";
import { PublicationController } from "../modules/shopify-publication/presentation/PublicationController.ts";
import { ListPublishedMedia } from "../modules/shopify-publication/application/ListPublishedMedia.ts";
import { PublicationUseCaseFactory } from "../modules/shopify-publication/infrastructure/PublicationUseCaseFactory.ts";
import { QueueProductRestores } from "../modules/shopify-publication/application/QueueProductRestores.ts";
import { WatermarkController } from "../modules/watermark/presentation/WatermarkController.ts";
import { CreateWatermarkJob } from "../modules/watermark/application/CreateWatermarkJob.ts";
import { ListWatermarkJobs } from "../modules/watermark/application/ListWatermarkJobs.ts";
import { ListStudioProducts } from "../modules/watermark/application/ListStudioProducts.ts";
import { GetWatermarkJob } from "../modules/watermark/application/GetWatermarkJob.ts";
import { RetryWatermarkJob } from "../modules/watermark/application/RetryWatermarkJob.ts";
import { CancelWatermarkJob } from "../modules/watermark/application/CancelWatermarkJob.ts";
import { ProcessWatermarkJob } from "../modules/watermark/application/ProcessWatermarkJob.ts";
import { CreateWatermarkBatch } from "../modules/watermark/application/CreateWatermarkBatch.ts";
import { CreateFilteredWatermarkBatches } from "../modules/watermark/application/CreateFilteredWatermarkBatches.ts";
import { ListWatermarkBatches } from "../modules/watermark/application/ListWatermarkBatches.ts";
import { CancelWatermarkBatch } from "../modules/watermark/application/CancelWatermarkBatch.ts";
import { EnqueueWatermarkJob } from "../modules/watermark/application/EnqueueWatermarkJob.ts";
import { EnqueueJob } from "../modules/jobs/application/EnqueueJob.ts";
import { SHOP_COLLECTIONS } from "../modules/catalog/tokens.ts";
import { ProductsController } from "./products/ProductsController.ts";
import { ProductsService } from "./products/ProductsService.ts";
import { SpaModule } from "./SpaModule.ts";
import { PRISMA_CLIENT, SHOPIFY } from "../shared/nest/tokens.ts";

describe("Nest API routes", () => {
  it("passes the Shopify session and JSON body to controllers", async () => {
    const createBatch = vi.fn().mockResolvedValue({
      id: "batch-1",
      totalJobs: 1,
      createdAt: new Date("2026-09-29T00:00:00Z"),
    });
    const unused = {};

    @Module({
      controllers: [
        CatalogController,
        MediaController,
        WatermarkController,
        PublicationController,
        ProductsController,
      ],
      providers: [
        { provide: ListProducts, useValue: { execute: async (shop: string) => [{ id: shop }] } },
        { provide: ListProductTypes, useValue: unused },
        { provide: StartCatalogSync, useValue: unused },
        { provide: GetCatalogSyncStatus, useValue: unused },
        { provide: SHOP_COLLECTIONS, useValue: unused },
        {
          provide: MediaService,
          useValue: {
            readForShop: async () => ({
              asset: { mimeType: "image/png" },
              bytes: Buffer.from("image"),
            }),
          },
        },
        { provide: ListPublishedMedia, useValue: { execute: async () => [] } },
        { provide: PublicationUseCaseFactory, useValue: unused },
        { provide: QueueProductRestores, useValue: unused },
        { provide: CreateWatermarkBatch, useValue: { execute: createBatch } },
        { provide: CreateFilteredWatermarkBatches, useValue: unused },
        { provide: CreateWatermarkJob, useValue: unused },
        { provide: ListWatermarkJobs, useValue: unused },
        { provide: ListStudioProducts, useValue: unused },
        {
          provide: GetWatermarkJob,
          useValue: { execute: async () => { throw new Error("Không tìm thấy watermark job"); } },
        },
        { provide: RetryWatermarkJob, useValue: unused },
        { provide: CancelWatermarkJob, useValue: unused },
        { provide: ProcessWatermarkJob, useValue: unused },
        { provide: ListWatermarkBatches, useValue: unused },
        { provide: CancelWatermarkBatch, useValue: unused },
        { provide: EnqueueJob, useValue: unused },
        { provide: EnqueueWatermarkJob, useValue: unused },
        { provide: ProductsService, useValue: { count: async () => 7 } },
        { provide: PRISMA_CLIENT, useValue: unused },
        { provide: SHOPIFY, useValue: unused },
      ],
    })
    class ApiTestModule {}

    @Module({ imports: [ApiTestModule, SpaModule] })
    class TestAppModule {}

    const app = await NestFactory.create(TestAppModule, { logger: false });
    app.use((_request: Request, response: Response, next: NextFunction) => {
      response.locals.shopify = { session: { shop: "test.myshopify.com" } };
      next();
    });
    const http = app.getHttpAdapter().getInstance() as Express;
    http.post("/api/webhooks", (request, response) => {
      response.json({ bodyParsed: request.body !== undefined });
    });

    try {
      await app.listen(0, "127.0.0.1");
      const port = (app.getHttpServer().address() as AddressInfo).port;
      const base = `http://127.0.0.1:${port}`;

      const catalog = await fetch(`${base}/api/catalog/products`);
      expect(catalog.status).toBe(200);
      expect(await catalog.json()).toEqual({ products: [{ id: "test.myshopify.com" }] });

      const count = await fetch(`${base}/api/products/count`);
      expect(count.status).toBe(200);
      expect(await count.json()).toEqual({ count: 7 });

      const publications = await fetch(`${base}/api/publications`);
      expect(publications.status).toBe(200);
      expect(await publications.json()).toEqual({ publications: [] });

      const media = await fetch(`${base}/api/media/assets/asset-1/content`);
      expect(media.status).toBe(200);
      expect(media.headers.get("content-type")).toContain("image/png");
      expect(media.headers.get("cache-control")).toBe("private, max-age=3600");
      expect(await media.text()).toBe("image");

      const batch = await fetch(`${base}/api/watermarks/batches`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productIds: ["product-1"] }),
      });
      expect(batch.status).toBe(201);
      expect((await batch.json() as { batch: { id: string } }).batch.id).toBe("batch-1");
      expect(createBatch).toHaveBeenCalledWith(expect.objectContaining({
        shopDomain: "test.myshopify.com",
        selection: { kind: "PRODUCT_IDS", productIds: ["product-1"] },
      }));

      const typeBatch = await fetch(`${base}/api/watermarks/batches`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productType: "Áo thun" }),
      });
      expect(typeBatch.status).toBe(201);
      expect(createBatch).toHaveBeenLastCalledWith(expect.objectContaining({
        selection: { kind: "PRODUCT_TYPE", productType: "Áo thun" },
      }));

      const ambiguousBatch = await fetch(`${base}/api/watermarks/batches`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productIds: ["product-1"], productType: "Áo thun" }),
      });
      expect(ambiguousBatch.status).toBe(400);

      const invalidBatch = await fetch(`${base}/api/watermarks/batches`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productIds: "product-1" }),
      });
      expect(invalidBatch.status).toBe(400);
      expect(await invalidBatch.json()).toEqual({ error: "productIds phải là một mảng" });

      const missingJob = await fetch(`${base}/api/watermarks/jobs/job-1`);
      expect(missingJob.status).toBe(404);
      expect(await missingJob.json()).toEqual({ error: "Không tìm thấy watermark job" });

      const spa = await fetch(`${base}/`);
      expect(spa.status).toBe(200);
      expect(spa.headers.get("content-type")).toContain("text/html");
      expect(await spa.text()).toContain("<html");

      const webhook = await fetch(`${base}/api/webhooks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: 1 }),
      });
      expect(webhook.status).toBe(200);
      expect(await webhook.json()).toEqual({ bodyParsed: false });
    } finally {
      await app.close();
    }
  });
});
