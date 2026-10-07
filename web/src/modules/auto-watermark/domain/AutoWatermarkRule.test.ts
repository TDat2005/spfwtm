import { describe, expect, it } from "vitest";
import { decideAutoWatermark, type ProductAutoState } from "./AutoWatermarkDecision.ts";
import { AutoWatermarkRule, compareRules, type AutoWatermarkRuleProps } from "./AutoWatermarkRule.ts";

const COLLECTION = "gid://shopify/Collection/42";

function rule(overrides: Partial<AutoWatermarkRuleProps> = {}): AutoWatermarkRule {
  return new AutoWatermarkRule({
    id: "rule-1",
    shopDomain: "a.myshopify.com",
    name: "Rule",
    enabled: true,
    priority: 0,
    scope: "ALL",
    scopeValue: null,
    scopeLabel: null,
    designId: "design-1",
    onNewProduct: true,
    onPrimaryChanged: false,
    syncScope: false,
    autoPublish: false,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    ...overrides,
  });
}

const product = (overrides: Partial<ProductAutoState> = {}): ProductAutoState => ({
  catalogProductId: "cp-1",
  shopifyProductId: "gid://shopify/Product/1",
  productType: "Áo",
  sourceVersion: 1,
  sourceImageUrl: "https://cdn.shopify.com/a.jpg",
  lastAuto: null,
  hasManualWatermark: false,
  ...overrides,
});

describe("AutoWatermarkRule", () => {
  it("kiểm tra phạm vi khi tạo rule", () => {
    expect(() => rule({ scope: "COLLECTION", scopeValue: null })).toThrow("Hãy chọn collection");
    expect(() => rule({ scope: "COLLECTION", scopeValue: "Sale" })).toThrow("Collection không hợp lệ");
    expect(() => rule({ priority: 1.5 })).toThrow("Độ ưu tiên");
    expect(() => rule({ name: "  " })).toThrow("Tên rule");
    expect(rule({ scope: "ALL", scopeValue: "bỏ qua" }).scopeValue).toBeNull();
    expect(rule({ scope: "PRODUCT_TYPE", scopeValue: "" }).scopeValue).toBe("");
  });

  it("khớp phạm vi tĩnh; collection phải hỏi Shopify", () => {
    expect(rule().matchesStatically({ productType: "x" })).toBe(true);
    expect(rule({ scope: "PRODUCT_TYPE", scopeValue: "Áo" }).matchesStatically({ productType: " Áo " })).toBe(true);
    expect(rule({ scope: "PRODUCT_TYPE", scopeValue: "Áo" }).matchesStatically({ productType: "Quần" })).toBe(false);
    expect(rule({ scope: "COLLECTION", scopeValue: COLLECTION }).matchesStatically({ productType: "Áo" })).toBeNull();
  });

  it("chỉ hành động với trigger đã bật, và không bao giờ khi rule tắt", () => {
    const r = rule({ onNewProduct: true, onPrimaryChanged: false, syncScope: true });
    expect(r.acts("NEW_PRODUCT")).toBe(true);
    expect(r.acts("PRIMARY_CHANGED")).toBe(false);
    expect(r.acts("SYNC")).toBe(true);
    expect(r.acts("MANUAL")).toBe(true);
    expect(r.with({ enabled: false }).acts("MANUAL")).toBe(false);
  });

  it("xếp rule ưu tiên cao trước, bằng nhau thì rule tạo trước thắng", () => {
    const low = rule({ id: "low", priority: 0 });
    const high = rule({ id: "high", priority: 5 });
    const olderSame = rule({ id: "older", priority: 5, createdAt: new Date("2026-09-01T00:00:00Z") });
    expect([low, high, olderSame].sort(compareRules).map((r) => r.id)).toEqual(["older", "high", "low"]);
  });
});

describe("decideAutoWatermark", () => {
  const r = rule({ id: "rule-1", designId: "design-1" });

  it("tạo job cho sản phẩm có ảnh chưa được rule áp", () => {
    expect(decideAutoWatermark(r, product(), "NEW_PRODUCT")).toEqual({ create: true });
  });

  it("không render lại khi đã áp đúng rule, design và phiên bản ảnh", () => {
    const applied = product({ lastAuto: { ruleId: "rule-1", designId: "design-1", sourceVersion: 1 } });
    expect(decideAutoWatermark(r, applied, "SYNC")).toEqual({ create: false, reason: "ALREADY_APPLIED" });
  });

  it("áp lại khi ảnh nguồn đổi phiên bản hoặc rule đổi thiết kế", () => {
    const applied = { ruleId: "rule-1", designId: "design-1", sourceVersion: 1 };
    expect(decideAutoWatermark(r, product({ sourceVersion: 2, lastAuto: applied }), "PRIMARY_CHANGED").create).toBe(true);
    expect(decideAutoWatermark(r.with({ designId: "design-2" }), product({ lastAuto: applied }), "SYNC").create).toBe(true);
  });

  it("áp hàng loạt không đè watermark merchant làm tay, nhưng webhook đổi ảnh thì vẫn áp", () => {
    const manual = product({ hasManualWatermark: true });
    expect(decideAutoWatermark(r, manual, "SYNC")).toEqual({ create: false, reason: "MANUAL_WATERMARK" });
    expect(decideAutoWatermark(r, manual, "MANUAL")).toEqual({ create: false, reason: "MANUAL_WATERMARK" });
    expect(decideAutoWatermark(r, manual, "PRIMARY_CHANGED")).toEqual({ create: true });
  });

  it("bỏ qua sản phẩm không có ảnh", () => {
    expect(decideAutoWatermark(r, product({ sourceImageUrl: null }), "SYNC")).toEqual({
      create: false,
      reason: "NO_IMAGE",
    });
  });
});
