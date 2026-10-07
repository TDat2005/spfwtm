import {
  decideAutoWatermark,
  type AutoWatermarkSkipReason,
  type ProductAutoState,
} from "../domain/AutoWatermarkDecision.ts";
import { compareRules, type AutoWatermarkRule } from "../domain/AutoWatermarkRule.ts";
import type {
  AutoWatermarkJobQueue,
  AutoWatermarkJobWriter,
  AutoWatermarkRuleRepository,
  ProductAutoStateReader,
  ShopCollections,
  ShopCollectionsFactory,
} from "./AutoWatermarkPorts.ts";

export interface RuleApplySummary {
  ruleId: string;
  ruleName: string;
  /** Sản phẩm thuộc phạm vi mà rule này sở hữu (không bị rule ưu tiên hơn giành). */
  ownedProducts: number;
  createdJobs: number;
  batchId: string | null;
  skipped: Record<AutoWatermarkSkipReason, number>;
  /** Có trong collection trên Shopify nhưng chưa có trong catalog của app. */
  notInCatalog: number;
  collectionMissing: boolean;
}

export type ApplyAutoWatermarkInput =
  | { shopDomain: string; trigger: "SYNC" }
  | { shopDomain: string; trigger: "MANUAL"; ruleId: string };

/**
 * Áp rule cho sản phẩm đang nằm trong phạm vi (đồng bộ đêm hoặc "Áp dụng ngay").
 *
 * Duyệt rule từ ưu tiên cao xuống thấp; mỗi sản phẩm thuộc về rule đầu tiên khớp.
 * Rule ưu tiên cao hơn vẫn được xét để giành quyền sở hữu dù không hành động ở
 * lượt này, nên rule thấp hơn không đè lên sản phẩm của nó.
 *
 * Không có webhook nào báo sản phẩm vào/ra collection, nên đây là cách duy nhất
 * để rule theo collection bắt kịp thay đổi thành viên.
 */
export class ApplyAutoWatermarkRules {
  constructor(
    private readonly rules: AutoWatermarkRuleRepository,
    private readonly products: ProductAutoStateReader,
    private readonly collections: ShopCollectionsFactory,
    private readonly writer: AutoWatermarkJobWriter,
    private readonly queue: AutoWatermarkJobQueue,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: ApplyAutoWatermarkInput): Promise<RuleApplySummary[]> {
    const rules = (await this.rules.listByShop(input.shopDomain))
      .filter((rule) => rule.enabled)
      .sort(compareRules);
    const acting = new Set(
      rules
        .filter((rule) =>
          input.trigger === "MANUAL" ? rule.id === input.ruleId : rule.acts("SYNC")
        )
        .map((rule) => rule.id)
    );
    if (input.trigger === "MANUAL" && acting.size === 0) {
      throw new Error("Rule không tồn tại hoặc đang tắt");
    }
    if (acting.size === 0) return [];

    // Rule thấp hơn rule hành động cuối cùng không ảnh hưởng ai sở hữu sản phẩm nào.
    let lastActingIndex = -1;
    rules.forEach((rule, index) => {
      if (acting.has(rule.id)) lastActingIndex = index;
    });
    const products = await this.products.listProducts(input.shopDomain);
    const byShopifyId = new Map(products.map((product) => [product.shopifyProductId, product]));
    const claimed = new Set<string>();
    let collections: ShopCollections | null = null;
    const summaries: RuleApplySummary[] = [];

    for (const rule of rules.slice(0, lastActingIndex + 1)) {
      let candidates: ProductAutoState[];
      let notInCatalog = 0;
      let collectionMissing = false;

      if (rule.scope === "COLLECTION") {
        collections ??= await this.collections.forShop(input.shopDomain);
        const ids = await collections.listProductIds(rule.scopeValue!);
        if (ids === null) {
          collectionMissing = true;
          candidates = [];
        } else {
          candidates = ids.flatMap((id) => {
            const product = byShopifyId.get(id);
            if (!product) notInCatalog += 1;
            return product ? [product] : [];
          });
        }
      } else {
        candidates = products.filter((product) => rule.matchesStatically(product));
      }

      const owned = candidates.filter((product) => !claimed.has(product.catalogProductId));
      for (const product of owned) claimed.add(product.catalogProductId);
      if (!acting.has(rule.id)) continue;

      summaries.push(
        await this.applyRule(rule, owned, input.trigger, { notInCatalog, collectionMissing })
      );
    }

    await this.rules.markApplied([...acting], this.now());
    return summaries;
  }

  private async applyRule(
    rule: AutoWatermarkRule,
    owned: ProductAutoState[],
    trigger: ApplyAutoWatermarkInput["trigger"],
    extra: { notInCatalog: number; collectionMissing: boolean },
  ): Promise<RuleApplySummary> {
    const skipped: Record<AutoWatermarkSkipReason, number> = {
      NO_IMAGE: 0,
      ALREADY_APPLIED: 0,
      MANUAL_WATERMARK: 0,
    };
    const toCreate: ProductAutoState[] = [];
    for (const product of owned) {
      const decision = decideAutoWatermark(rule, product, trigger);
      if (decision.create) toCreate.push(product);
      else skipped[decision.reason] += 1;
    }

    let batchId: string | null = null;
    if (toCreate.length > 0) {
      ({ batchId } = await this.writer.createJobs({ rule, products: toCreate, asBatch: true }));
      if (batchId) await this.queue.dispatchBatch(batchId);
    }

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      ownedProducts: owned.length,
      createdJobs: toCreate.length,
      batchId,
      skipped,
      ...extra,
    };
  }
}
