import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Global, Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { AddressInfo } from "node:net";
import type { NextFunction, Request, Response } from "express";
import { CatalogController } from "../modules/catalog/presentation/CatalogController.ts";
import { ListProducts } from "../modules/catalog/application/ListProducts.ts";
import { ListProductTypes } from "../modules/catalog/application/ListProductTypes.ts";
import { StartCatalogSync } from "../modules/catalog/application/StartCatalogSync.ts";
import { GetCatalogSyncStatus } from "../modules/catalog/application/GetCatalogSyncStatus.ts";
import { PublicationController } from "../modules/shopify-publication/presentation/PublicationController.ts";
import { ListPublishedMedia } from "../modules/shopify-publication/application/ListPublishedMedia.ts";
import { PublicationUseCaseFactory } from "../modules/shopify-publication/infrastructure/PublicationUseCaseFactory.ts";
import { QueueProductRestores } from "../modules/shopify-publication/application/QueueProductRestores.ts";
import { EnqueueJob } from "../modules/jobs/application/EnqueueJob.ts";
import { RegisterAccount, SignIn } from "../modules/standalone/application/StandaloneAccounts.ts";
import type { AccountRepository } from "../modules/standalone/application/StandalonePorts.ts";
import { RemoveImageProduct, UploadImageProduct } from "../modules/standalone/application/UploadedImages.ts";
import type { Account } from "../modules/standalone/domain/Account.ts";
import { ScryptPasswordHasher } from "../modules/standalone/infrastructure/ScryptPasswordHasher.ts";
import { StandaloneAuthController } from "../modules/standalone/presentation/StandaloneAuthController.ts";
import { StandaloneImagesController } from "../modules/standalone/presentation/StandaloneImagesController.ts";
import { ACCOUNT_REPOSITORY } from "../modules/standalone/tokens.ts";
import { TenantModule } from "../shared/nest/TenantModule.ts";
import { PRISMA_CLIENT, SHOPIFY } from "../shared/nest/tokens.ts";
import { SHOP_COLLECTIONS } from "../modules/catalog/tokens.ts";
import { SpaModule } from "./SpaModule.ts";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

const accountsById = new Map<string, Account>();
const accounts: AccountRepository = {
  findByEmail: async (email) => [...accountsById.values()].find((a) => a.email === email) ?? null,
  findById: async (id) => accountsById.get(id) ?? null,
  create: async (account) => void accountsById.set(account.id, account),
};
const uploadedTo: string[] = [];

/** Shopify giả: chỉ chấp nhận đúng một session token. */
@Global()
@Module({
  providers: [
    {
      provide: SHOPIFY,
      useValue: {
        validateAuthenticatedSession: () => (request: Request, response: Response, next: NextFunction) => {
          if (request.headers.authorization !== "Bearer shopify-token") {
            response.status(403).end();
            return;
          }
          response.locals.shopify = { session: { shop: "test.myshopify.com" } };
          next();
        },
      },
    },
  ],
  exports: [SHOPIFY],
})
class FakeShopifyModule {}

@Module({
  imports: [TenantModule],
  controllers: [CatalogController, PublicationController, StandaloneAuthController, StandaloneImagesController],
  providers: [
    { provide: ListProducts, useValue: { execute: async (shop: string) => [{ id: shop }] } },
    { provide: ListProductTypes, useValue: {} },
    { provide: StartCatalogSync, useValue: {} },
    { provide: GetCatalogSyncStatus, useValue: {} },
    { provide: SHOP_COLLECTIONS, useValue: {} },
    { provide: ListPublishedMedia, useValue: { execute: async () => [] } },
    { provide: PublicationUseCaseFactory, useValue: {} },
    { provide: QueueProductRestores, useValue: {} },
    { provide: PRISMA_CLIENT, useValue: {} },
    { provide: EnqueueJob, useValue: {} },
    { provide: ACCOUNT_REPOSITORY, useValue: accounts },
    { provide: RegisterAccount, useValue: new RegisterAccount(accounts, new ScryptPasswordHasher()) },
    { provide: SignIn, useValue: new SignIn(accounts, new ScryptPasswordHasher()) },
    {
      provide: UploadImageProduct,
      useValue: new UploadImageProduct(
        {
          storeUploaded: async (shopDomain) => {
            uploadedTo.push(shopDomain);
            return { id: "asset-1" };
          },
        },
        { add: async () => {}, remove: async () => false },
      ),
    },
    { provide: RemoveImageProduct, useValue: {} },
  ],
})
class ApiModule {}

@Module({ imports: [FakeShopifyModule, ApiModule, SpaModule] })
class TestAppModule {}

describe("Chạy song song chế độ Shopify và độc lập", () => {
  let app: INestApplication;
  let base: string;
  const previousSecret = process.env.STANDALONE_SESSION_SECRET;

  beforeAll(async () => {
    process.env.STANDALONE_SESSION_SECRET = "test-secret";
    app = await NestFactory.create(TestAppModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
    if (previousSecret === undefined) delete process.env.STANDALONE_SESSION_SECRET;
    else process.env.STANDALONE_SESSION_SECRET = previousSecret;
  });

  it("phục vụ HTML khác nhau theo việc có ?shop= hay không", async () => {
    const standalone = await (await fetch(`${base}/`)).text();
    expect(standalone).toContain('<meta name="app-platform" content="standalone" />');
    expect(standalone).not.toContain("app-bridge.js");
    expect(standalone).not.toContain("shopify-api-key");

    const embedded = await (await fetch(`${base}/?shop=test.myshopify.com&host=abc`)).text();
    expect(embedded).toContain("app-bridge.js");
    expect(embedded).not.toContain("app-platform");
  });

  it("đăng ký, gọi API dùng chung và bị chặn ở API chỉ dành cho Shopify", async () => {
    expect((await fetch(`${base}/api/catalog/products`)).status).toBe(401);
    expect((await fetch(`${base}/api/standalone/auth/me`)).status).toBe(401);

    const signup = await fetch(`${base}/api/standalone/auth/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "Owner@Example.com", password: "mat-khau-dai" }),
    });
    expect(signup.status).toBe(201);
    const cookie = signup.headers.get("set-cookie")!.split(";")[0]!;
    const accountId = [...accountsById.keys()][0];

    const me = await fetch(`${base}/api/standalone/auth/me`, { headers: { cookie } });
    expect(await me.json()).toEqual({ account: { email: "owner@example.com" } });

    const catalog = await fetch(`${base}/api/catalog/products`, { headers: { cookie } });
    expect(catalog.status).toBe(200);
    expect(await catalog.json()).toEqual({ products: [{ id: `${accountId}.standalone.local` }] });

    const publications = await fetch(`${base}/api/publications`, { headers: { cookie } });
    expect(publications.status).toBe(403);

    const form = new FormData();
    form.append("image", new Blob([PNG], { type: "image/png" }), "ao-thun.png");
    const upload = await fetch(`${base}/api/standalone/images`, { method: "POST", headers: { cookie }, body: form });
    expect(upload.status).toBe(201);
    expect(((await upload.json()) as { product: { title: string } }).product.title).toBe("ao-thun");
    expect(uploadedTo).toEqual([`${accountId}.standalone.local`]);

    const crossSite = await fetch(`${base}/api/standalone/images`, {
      method: "POST",
      headers: { cookie, origin: "https://evil.test" },
      body: form,
    });
    expect(crossSite.status).toBe(403);

    const wrongPassword = await fetch(`${base}/api/standalone/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "owner@example.com", password: "sai-mat-khau" }),
    });
    expect(wrongPassword.status).toBe(401);

    const logout = await fetch(`${base}/api/standalone/auth/logout`, { method: "POST", headers: { cookie } });
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("giữ nguyên luồng Shopify khi có session token", async () => {
    const auth = { authorization: "Bearer shopify-token" };
    const catalog = await fetch(`${base}/api/catalog/products`, { headers: auth });
    expect(await catalog.json()).toEqual({ products: [{ id: "test.myshopify.com" }] });

    expect((await fetch(`${base}/api/publications`, { headers: auth })).status).toBe(200);
    expect((await fetch(`${base}/api/catalog/products`, { headers: { authorization: "Bearer sai" } })).status).toBe(403);

    const form = new FormData();
    form.append("image", new Blob([PNG], { type: "image/png" }), "a.png");
    const upload = await fetch(`${base}/api/standalone/images`, { method: "POST", headers: auth, body: form });
    expect(upload.status).toBe(403);
  });
});
