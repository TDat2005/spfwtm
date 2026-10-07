import type { AutoWatermarkRule, AutoWatermarkTrigger } from "./AutoWatermarkRule.ts";

export interface ProductAutoState {
  catalogProductId: string;
  shopifyProductId: string;
  productType: string;
  sourceVersion: number;
  /** Ảnh gốc hiện tại (không phải ảnh watermark của app). */
  sourceImageUrl: string | null;
  /** Job auto gần nhất đã tạo cho sản phẩm. */
  lastAuto: { ruleId: string; designId: string; sourceVersion: number } | null;
  /** Đang có ảnh watermark merchant tự đưa lên (không do rule nào tạo). */
  hasManualWatermark: boolean;
  /** Ảnh watermark do rule đưa lên Shopify và còn trên sản phẩm. */
  publishedByRules: ReadonlyArray<{ ruleId: string; watermarkJobId: string }>;
}

export type AutoWatermarkSkipReason =
  | "NO_IMAGE"
  | "ALREADY_APPLIED"
  | "MANUAL_WATERMARK";

export type AutoWatermarkDecision =
  | { create: true }
  | { create: false; reason: AutoWatermarkSkipReason };

/**
 * Rule sở hữu sản phẩm đã được chọn; quyết định có tạo job mới không.
 *
 * - Đã có job auto cùng rule, cùng design, cùng phiên bản ảnh nguồn: bỏ qua,
 *   nên đồng bộ đêm và webhook lặp lại không render lại.
 * - Khi áp hàng loạt (SYNC/MANUAL), không đè ảnh watermark merchant tự làm tay.
 *   Webhook đổi ảnh chính thì vẫn áp, vì ảnh watermark tay đó thuộc ảnh cũ.
 */
export function decideAutoWatermark(
  rule: AutoWatermarkRule,
  product: ProductAutoState,
  trigger: AutoWatermarkTrigger
): AutoWatermarkDecision {
  if (!product.sourceImageUrl) return { create: false, reason: "NO_IMAGE" };

  const last = product.lastAuto;
  if (
    last &&
    last.ruleId === rule.id &&
    last.designId === rule.designId &&
    last.sourceVersion === product.sourceVersion
  ) {
    return { create: false, reason: "ALREADY_APPLIED" };
  }

  if ((trigger === "SYNC" || trigger === "MANUAL") && product.hasManualWatermark) {
    return { create: false, reason: "MANUAL_WATERMARK" };
  }

  return { create: true };
}
