import { describe, expect, it, vi } from "vitest";
import { Product } from "../domain/Product.ts";
import type {
  CatalogSyncPageInput,
  CatalogSyncQueue,
  CatalogSyncRepository,
  CatalogSyncState,
} from "./CatalogSyncPorts.ts";
import type { ProductGatewayFactory, ProductPage } from "./ProductGateway.ts";
import type { ProductRepository } from "./ProductRepository.ts";
import { StartCatalogSync } from "./StartCatalogSync.ts";
import { SyncCatalogPage } from "./SyncCatalogPage.ts";

const SHOP = "test.myshopify.com";

function product(id: string): Product {
  return new Product({ id, title: id, status: "ACTIVE", imageUrl: null, imageAltText: null });
}

function fakeSyncs(overrides: Partial<CatalogSyncRepository> = {}): CatalogSyncRepository {
  const state: CatalogSyncState = {
    syncId: "sync-1",
    status: "RUNNING",
    syncedCount: 0,
    error: null,
    startedAt: null,
    finishedAt: null,
  };
  return {
    getState: vi.fn().mockResolvedValue(state),
    tryStart: vi.fn().mockResolvedValue(true),
    isActive: vi.fn().mockResolvedValue(true),
    recordPage: vi.fn().mockResolvedValue(undefined),
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function fakeQueue(): CatalogSyncQueue & { pages: CatalogSyncPageInput[] } {
  const pages: CatalogSyncPageInput[] = [];
  return {
    pages,
    enqueuePage: vi.fn(async (input: CatalogSyncPageInput) => {
      pages.push(input);
    }),
  };
}

function fakeGateways(pages: Record<string, ProductPage>): ProductGatewayFactory {
  return {
    forShop: async () => ({
      listPage: async (cursor) => pages[cursor ?? "first"]!,
    }),
  };
}

describe("StartCatalogSync", () => {
  it("xếp trang đầu tiên khi bắt đầu sync mới", async () => {
    const syncs = fakeSyncs();
    const queue = fakeQueue();

    await new StartCatalogSync(syncs, queue).execute(SHOP);

    expect(queue.pages).toHaveLength(1);
    expect(queue.pages[0]).toMatchObject({ shopDomain: SHOP, page: 1, cursor: null });
  });

  it("không xếp job khi shop đang có sync chạy", async () => {
    const syncs = fakeSyncs({ tryStart: vi.fn().mockResolvedValue(false) });
    const queue = fakeQueue();

    const state = await new StartCatalogSync(syncs, queue).execute(SHOP);

    expect(queue.pages).toHaveLength(0);
    expect(state.status).toBe("RUNNING");
  });

  it("đánh dấu FAILED nếu không xếp được job", async () => {
    const syncs = fakeSyncs();
    const queue: CatalogSyncQueue = {
      enqueuePage: vi.fn().mockRejectedValue(new Error("Redis down")),
    };

    await expect(new StartCatalogSync(syncs, queue).execute(SHOP)).rejects.toThrow("Redis down");
    expect(syncs.fail).toHaveBeenCalled();
  });
});

describe("SyncCatalogPage", () => {
  const products: ProductRepository = {
    upsertMany: vi.fn().mockResolvedValue(undefined),
    listByShop: vi.fn(),
  };

  it("lưu trang hiện tại rồi xếp trang kế khi còn cursor", async () => {
    const syncs = fakeSyncs();
    const queue = fakeQueue();
    const gateways = fakeGateways({
      first: { products: [product("p1"), product("p2")], nextCursor: "c2" },
    });

    await new SyncCatalogPage(gateways, products, syncs, queue).execute({
      shopDomain: SHOP,
      syncId: "sync-1",
      page: 1,
      cursor: null,
    });

    expect(products.upsertMany).toHaveBeenCalledWith(SHOP, [product("p1"), product("p2")]);
    expect(syncs.recordPage).toHaveBeenCalledWith(SHOP, "sync-1", 1, 2);
    expect(queue.pages).toEqual([{ shopDomain: SHOP, syncId: "sync-1", page: 2, cursor: "c2" }]);
    expect(syncs.complete).not.toHaveBeenCalled();
  });

  it("hoàn tất sync ở trang cuối", async () => {
    const syncs = fakeSyncs();
    const queue = fakeQueue();
    const gateways = fakeGateways({ c2: { products: [product("p3")], nextCursor: null } });

    await new SyncCatalogPage(gateways, products, syncs, queue).execute({
      shopDomain: SHOP,
      syncId: "sync-1",
      page: 2,
      cursor: "c2",
    });

    expect(queue.pages).toHaveLength(0);
    expect(syncs.complete).toHaveBeenCalledWith(SHOP, "sync-1");
  });

  it("bỏ qua job của sync đã bị thay thế", async () => {
    const syncs = fakeSyncs({ isActive: vi.fn().mockResolvedValue(false) });
    const forShop = vi.fn();

    await new SyncCatalogPage({ forShop }, products, syncs, fakeQueue()).execute({
      shopDomain: SHOP,
      syncId: "old-sync",
      page: 3,
      cursor: "c3",
    });

    expect(forShop).not.toHaveBeenCalled();
  });
});
