import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { NestFactory } from "@nestjs/core";
import type { AddressInfo } from "node:net";
import type { Express, NextFunction, Request, Response } from "express";
import { AppModule } from "./AppModule.ts";
import type { AppDependencies } from "./AppDependencies.ts";

describe("Nest API routes", () => {
  it("passes the Shopify session and JSON body to controllers", async () => {
    const createBatch = vi.fn().mockResolvedValue({
      id: "batch-1",
      totalJobs: 1,
      createdAt: new Date("2026-09-29T00:00:00Z"),
    });
    const dependencies = {
      createListProducts: () => ({ execute: async (shop: string) => [{ id: shop }] }),
      createWatermarkBatch: { execute: createBatch },
      countProducts: async () => 7,
      listPublishedMedia: { execute: async () => [] },
      mediaService: {
        readForShop: async () => ({ asset: { mimeType: "image/png" }, bytes: Buffer.from("image") }),
      },
    } as unknown as AppDependencies;
    const app = await NestFactory.create(AppModule.register(dependencies), { logger: false });
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
        productIds: ["product-1"],
      }));

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
