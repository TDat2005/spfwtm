import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Express } from "express";
import serveStatic from "serve-static";
import { AppModule } from "./src/app/AppModule.ts";
import { ReceiveProductWebhook } from "./src/modules/product-media-sync/application/ReceiveProductWebhook.ts";
import { createProductWebhookHandlers } from "./src/modules/product-media-sync/infrastructure/ProductWebhookHandlers.ts";
import shopify, { SHOPIFY_API_VERSION } from "./shopify.js";
import PrivacyWebhookHandlers from "./privacy.js";

const PORT = parseInt(
  process.env.BACKEND_PORT || process.env.PORT || "3000",
  10
);

const STATIC_PATH =
  process.env.NODE_ENV === "production"
    ? `${process.cwd()}/frontend/dist`
    : `${process.cwd()}/frontend/`;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const http = app.getHttpAdapter().getInstance() as Express;
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
        ...createProductWebhookHandlers(app.get(ReceiveProductWebhook), SHOPIFY_API_VERSION),
      },
    }),
  );

  app.use(shopify.cspHeaders());
  app.use(serveStatic(STATIC_PATH, { index: false }));
  const ensureInstalled = shopify.ensureInstalledOnShop();
  http.use((request, response, next) => {
    if (request.path === "/api" || request.path.startsWith("/api/")) return next();
    return ensureInstalled(request, response, next);
  });

  app.enableShutdownHooks();

  try {
    await app.listen(PORT);
  } catch (error) {
    await app.close();
    throw error;
  }
  Logger.log(`Backend đang chạy tại port ${PORT}.`, "Bootstrap");
}

void bootstrap().catch((error: unknown) => {
  Logger.error(error, "Không thể khởi động backend");
  process.exitCode = 1;
});
