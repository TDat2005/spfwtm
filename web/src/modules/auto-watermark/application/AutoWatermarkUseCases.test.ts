import { describe, expect, it, vi } from "vitest";
import type { ProductAutoState } from "../domain/AutoWatermarkDecision.ts";
import { AutoWatermarkRule, type AutoWatermarkRuleProps } from "../domain/AutoWatermarkRule.ts";
import { ApplyAutoWatermarkRules } from "./ApplyAutoWatermarkRules.ts";
import type {
  AutoWatermarkApplyQueue,
  AutoWatermarkJobQueue,
  AutoWatermarkJobWriter,
  AutoWatermarkRuleRepository,
  ProductAutoStateReader,
  ShopCollections,
  ShopCollectionsFactory,
  WatermarkDesignStore,
} from "./AutoWatermarkPorts.ts";
import { EvaluateProductRules } from "./EvaluateProductRules.ts";
import { ManageAutoWatermarkRules } from "./ManageAutoWatermarkRules.ts";

const SHOP = "a.myshopify.com";
const SALE = "gid://shopify/Collection/1";
const NEW_IN = "gid://shopify/Collection/2";
let sequence = 0;

function rule(overrides: Partial<AutoWatermarkRuleProps>): AutoWatermarkRule {
  sequence += 1;
  return new AutoWatermarkRule({
    id: `rule-${sequence}`,
    shopDomain: SHOP,
    name: `Rule ${sequence}`,
    enabled: true,
    priority: 0,
    scope: "ALL",
    scopeValue: null,
    scopeLabel: null,
    designId: `design-${sequence}`,
    onNewProduct: true,
    onPrimaryChanged: false,
    syncScope: false,
    autoPublish: false,
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, sequence)),
    ...overrides,
  });
}

function product(id: number, overrides: Partial<ProductAutoState> = {}): ProductAutoState {
  return {
    catalogProductId: `cp-${id}`,
    shopifyProductId: `gid://shopify/Product/${id}`,
    productType: "Áo",
    sourceVersion: 1,
    sourceImageUrl: `https://cdn.shopify.com/${id}.jpg`,
    lastAuto: null,
    hasManualWatermark: false,
    ...overrides,
  };
}

function setup(rules: AutoWatermarkRule[], products: ProductAutoState[], members: Record<string, number[]>) {
  const ruleRepo: AutoWatermarkRuleRepository = {
    listByShop: vi.fn(async () => rules),
    findById: vi.fn(async (id: string) => rules.find((r) => r.id === id) ?? null),
    save: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    markApplied: vi.fn(async () => undefined),
    listShopsWithSyncRules: vi.fn(async () => [SHOP]),
  };
  const reader: ProductAutoStateReader = {
    findProduct: vi.fn(async (_shop: string, id: string) => products.find((p) => p.shopifyProductId === id) ?? null),
    listProducts: vi.fn(async () => products),
  };
  const created: Array<{ ruleId: string; productIds: string[]; asBatch: boolean }> = [];
  const writer: AutoWatermarkJobWriter = {
    createJobs: vi.fn(async ({ rule: r, products: ps, asBatch }: Parameters<AutoWatermarkJobWriter["createJobs"]>[0]) => {
      created.push({ ruleId: r.id, productIds: ps.map((p) => p.catalogProductId), asBatch });
      return { batchId: asBatch ? `batch-${created.length}` : null, jobIds: ps.map((p) => `job-${p.catalogProductId}`) };
    }),
  };
  const queue: AutoWatermarkJobQueue = {
    enqueueJob: vi.fn(async () => undefined),
    dispatchBatch: vi.fn(async () => undefined),
  };
  const collections: ShopCollections = {
    isInCollection: vi.fn(async (productId: string, collectionId: string) =>
      (members[collectionId] ?? []).some((n) => `gid://shopify/Product/${n}` === productId)
    ),
    listProductIds: vi.fn(async (collectionId: string) =>
      collectionId in members ? (members[collectionId] ?? []).map((n) => `gid://shopify/Product/${n}`) : null
    ),
    getCollectionTitle: vi.fn(async (id: string) => (id in members ? `Title ${id}` : null)),
    search: vi.fn(async () => []),
  };
  const factory: ShopCollectionsFactory = { forShop: vi.fn(async () => collections) };
  return { ruleRepo, reader, writer, queue, collections, factory, created };
}

describe("EvaluateProductRules", () => {
  it("rule collection ưu tiên cao sở hữu sản phẩm trong collection, rule ALL lo phần còn lại", async () => {
    const sale = rule({ priority: 10, scope: "COLLECTION", scopeValue: SALE });
    const all = rule({ priority: 0 });
    const ctx = setup([all, sale], [product(1), product(2)], { [SALE]: [1] });
    const evaluate = new EvaluateProductRules(ctx.ruleRepo, ctx.reader, ctx.factory, ctx.writer, ctx.queue);

    const inSale = await evaluate.execute({ shopDomain: SHOP, productId: "gid://shopify/Product/1", trigger: "NEW_PRODUCT" });
    const notInSale = await evaluate.execute({ shopDomain: SHOP, productId: "gid://shopify/Product/2", trigger: "NEW_PRODUCT" });

    expect(inSale).toMatchObject({ outcome: "CREATED", ruleId: sale.id });
    expect(notInSale).toMatchObject({ outcome: "CREATED", ruleId: all.id });
    expect(ctx.created.every((c) => !c.asBatch)).toBe(true);
    expect(ctx.queue.enqueueJob).toHaveBeenCalledWith("job-cp-1", SHOP);
  });

  it("rule sở hữu không bật trigger thì rule thấp hơn cũng không được đóng dấu thay", async () => {
    const sale = rule({ priority: 10, scope: "COLLECTION", scopeValue: SALE, onNewProduct: false });
    const all = rule({ priority: 0, onNewProduct: true });
    const ctx = setup([all, sale], [product(1)], { [SALE]: [1] });
    const evaluate = new EvaluateProductRules(ctx.ruleRepo, ctx.reader, ctx.factory, ctx.writer, ctx.queue);

    const result = await evaluate.execute({ shopDomain: SHOP, productId: "gid://shopify/Product/1", trigger: "NEW_PRODUCT" });

    expect(result).toEqual({ outcome: "OWNER_INACTIVE", ruleId: sale.id });
    expect(ctx.writer.createJobs).not.toHaveBeenCalled();
  });

  it("không gọi Shopify khi không rule nào hành động với trigger", async () => {
    const sale = rule({ scope: "COLLECTION", scopeValue: SALE, onPrimaryChanged: false });
    const ctx = setup([sale], [product(1)], { [SALE]: [1] });
    const evaluate = new EvaluateProductRules(ctx.ruleRepo, ctx.reader, ctx.factory, ctx.writer, ctx.queue);

    const result = await evaluate.execute({ shopDomain: SHOP, productId: "gid://shopify/Product/1", trigger: "PRIMARY_CHANGED" });

    expect(result).toEqual({ outcome: "NO_ACTIVE_RULE" });
    expect(ctx.factory.forShop).not.toHaveBeenCalled();
  });

  it("chỉ hỏi Shopify tới rule đầu tiên khớp", async () => {
    const type = rule({ priority: 20, scope: "PRODUCT_TYPE", scopeValue: "Áo" });
    const sale = rule({ priority: 10, scope: "COLLECTION", scopeValue: SALE });
    const ctx = setup([sale, type], [product(1)], { [SALE]: [1] });
    const evaluate = new EvaluateProductRules(ctx.ruleRepo, ctx.reader, ctx.factory, ctx.writer, ctx.queue);

    const result = await evaluate.execute({ shopDomain: SHOP, productId: "gid://shopify/Product/1", trigger: "NEW_PRODUCT" });

    expect(result).toMatchObject({ outcome: "CREATED", ruleId: type.id });
    expect(ctx.collections.isInCollection).not.toHaveBeenCalled();
  });
});

describe("ApplyAutoWatermarkRules", () => {
  it("đồng bộ: mỗi sản phẩm thuộc rule ưu tiên cao nhất khớp, tạo một batch mỗi rule", async () => {
    const sale = rule({ priority: 10, scope: "COLLECTION", scopeValue: SALE, syncScope: true });
    const newIn = rule({ priority: 5, scope: "COLLECTION", scopeValue: NEW_IN, syncScope: true });
    const all = rule({ priority: 0, syncScope: true });
    const products = [1, 2, 3, 4].map((n) => product(n));
    const ctx = setup([all, newIn, sale], products, { [SALE]: [1, 2, 99], [NEW_IN]: [2, 3] });
    const apply = new ApplyAutoWatermarkRules(ctx.ruleRepo, ctx.reader, ctx.factory, ctx.writer, ctx.queue);

    const summaries = await apply.execute({ shopDomain: SHOP, trigger: "SYNC" });

    expect(ctx.created).toEqual([
      { ruleId: sale.id, productIds: ["cp-1", "cp-2"], asBatch: true },
      { ruleId: newIn.id, productIds: ["cp-3"], asBatch: true },
      { ruleId: all.id, productIds: ["cp-4"], asBatch: true },
    ]);
    expect(summaries[0]).toMatchObject({ ownedProducts: 2, notInCatalog: 1 });
    expect(ctx.queue.dispatchBatch).toHaveBeenCalledTimes(3);
    expect(ctx.ruleRepo.markApplied).toHaveBeenCalledWith(
      expect.arrayContaining([sale.id, newIn.id, all.id]),
      expect.any(Date),
    );
  });

  it("áp tay một rule: rule ưu tiên cao hơn vẫn giữ sản phẩm của nó dù không chạy ở lượt này", async () => {
    const sale = rule({ priority: 10, scope: "COLLECTION", scopeValue: SALE, syncScope: false });
    const all = rule({ priority: 0 });
    const ctx = setup([all, sale], [product(1), product(2)], { [SALE]: [1] });
    const apply = new ApplyAutoWatermarkRules(ctx.ruleRepo, ctx.reader, ctx.factory, ctx.writer, ctx.queue);

    await apply.execute({ shopDomain: SHOP, trigger: "MANUAL", ruleId: all.id });

    expect(ctx.created).toEqual([{ ruleId: all.id, productIds: ["cp-2"], asBatch: true }]);
  });

  it("không gọi Shopify cho rule collection thấp hơn rule hành động cuối cùng", async () => {
    const type = rule({ priority: 10, scope: "PRODUCT_TYPE", scopeValue: "Áo", syncScope: true });
    const sale = rule({ priority: 0, scope: "COLLECTION", scopeValue: SALE });
    const ctx = setup([sale, type], [product(1)], { [SALE]: [1] });
    const apply = new ApplyAutoWatermarkRules(ctx.ruleRepo, ctx.reader, ctx.factory, ctx.writer, ctx.queue);

    await apply.execute({ shopDomain: SHOP, trigger: "SYNC" });

    expect(ctx.factory.forShop).not.toHaveBeenCalled();
  });

  it("đếm lý do bỏ qua và báo collection đã bị xóa", async () => {
    const gone = rule({ priority: 10, scope: "COLLECTION", scopeValue: "gid://shopify/Collection/404", syncScope: true });
    const all = rule({ priority: 0, syncScope: true });
    const products = [
      product(1, { lastAuto: { ruleId: all.id, designId: all.designId, sourceVersion: 1 } }),
      product(2, { hasManualWatermark: true }),
      product(3, { sourceImageUrl: null }),
      product(4),
    ];
    const ctx = setup([gone, all], products, {});
    const apply = new ApplyAutoWatermarkRules(ctx.ruleRepo, ctx.reader, ctx.factory, ctx.writer, ctx.queue);

    const [goneSummary, allSummary] = await apply.execute({ shopDomain: SHOP, trigger: "SYNC" });

    expect(goneSummary).toMatchObject({ collectionMissing: true, createdJobs: 0, batchId: null });
    expect(allSummary).toMatchObject({
      ownedProducts: 4,
      createdJobs: 1,
      skipped: { ALREADY_APPLIED: 1, MANUAL_WATERMARK: 1, NO_IMAGE: 1 },
    });
  });

  it("từ chối áp tay rule đang tắt", async () => {
    const off = rule({ enabled: false });
    const ctx = setup([off], [product(1)], {});
    const apply = new ApplyAutoWatermarkRules(ctx.ruleRepo, ctx.reader, ctx.factory, ctx.writer, ctx.queue);

    await expect(apply.execute({ shopDomain: SHOP, trigger: "MANUAL", ruleId: off.id })).rejects.toThrow("đang tắt");
  });
});

describe("ManageAutoWatermarkRules", () => {
  function manage(members: Record<string, number[]> = { [SALE]: [] }) {
    const ctx = setup([], [], members);
    const designs: WatermarkDesignStore = {
      save: vi.fn(async () => "design-saved"),
      findByIds: vi.fn(async () => new Map()),
    };
    const applyQueue: AutoWatermarkApplyQueue = { requestApply: vi.fn(async () => undefined) };
    return { ctx, designs, applyQueue, useCase: new ManageAutoWatermarkRules(ctx.ruleRepo, designs, ctx.factory, applyQueue) };
  }
  const layers = [{ type: "TEXT" as const, text: "SALE", position: "CENTER" as const, opacity: 0.5 }];
  const settings = {
    name: "Sale",
    enabled: true,
    priority: 10,
    scope: "COLLECTION" as const,
    scopeValue: SALE,
    onNewProduct: true,
    onPrimaryChanged: true,
    syncScope: true,
    autoPublish: true,
  };

  it("tạo rule collection: lấy tên collection từ Shopify, lưu design và áp ngay nếu được yêu cầu", async () => {
    const { ctx, designs, applyQueue, useCase } = manage();

    const created = await useCase.create({ ...settings, shopDomain: SHOP, layers, applyNow: true });

    expect(created.scopeLabel).toBe(`Title ${SALE}`);
    expect(created.designId).toBe("design-saved");
    expect(ctx.ruleRepo.save).toHaveBeenCalledWith(created);
    expect(designs.save).toHaveBeenCalledTimes(1);
    expect(applyQueue.requestApply).toHaveBeenCalledWith({ shopDomain: SHOP, trigger: "MANUAL", ruleId: created.id });
  });

  it("input sai thì không gọi Shopify và không lưu design rác", async () => {
    const { ctx, designs, useCase } = manage();

    await expect(
      useCase.create({ ...settings, scopeValue: "Sale", shopDomain: SHOP, layers, applyNow: false }),
    ).rejects.toThrow("Collection không hợp lệ");
    await expect(
      useCase.create({ ...settings, shopDomain: SHOP, layers: [], applyNow: false }),
    ).rejects.toThrow("ít nhất một lớp");
    expect(ctx.factory.forShop).not.toHaveBeenCalled();
    expect(designs.save).not.toHaveBeenCalled();
  });

  it("báo lỗi khi collection không còn trên Shopify", async () => {
    const { useCase } = manage({});
    await expect(
      useCase.create({ ...settings, shopDomain: SHOP, layers, applyNow: false }),
    ).rejects.toThrow("Không tìm thấy collection");
  });
});
