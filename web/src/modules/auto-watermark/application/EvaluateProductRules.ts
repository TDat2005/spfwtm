import { decideAutoWatermark, type AutoWatermarkSkipReason } from "../domain/AutoWatermarkDecision.ts";
import {
  compareRules,
  type AutoWatermarkRule,
  type AutoWatermarkTrigger,
} from "../domain/AutoWatermarkRule.ts";
import type {
  AutoWatermarkJobQueue,
  AutoWatermarkJobWriter,
  AutoWatermarkRuleRepository,
  ProductAutoStateReader,
  ShopCollections,
  ShopCollectionsFactory,
} from "./AutoWatermarkPorts.ts";

export type EvaluationResult =
  | { outcome: "NO_ACTIVE_RULE" | "PRODUCT_NOT_FOUND" | "NO_MATCHING_RULE" }
  | { outcome: "OWNER_INACTIVE"; ruleId: string }
  | { outcome: "SKIPPED"; ruleId: string; reason: AutoWatermarkSkipReason }
  | { outcome: "CREATED"; ruleId: string; jobId: string };

/**
 * Xét một sản phẩm sau webhook (sản phẩm mới / đổi ảnh chính): tìm rule sở hữu
 * sản phẩm, và nếu rule đó hành động với trigger này thì tạo một job watermark.
 */
export class EvaluateProductRules {
  constructor(
    private readonly rules: AutoWatermarkRuleRepository,
    private readonly products: ProductAutoStateReader,
    private readonly collections: ShopCollectionsFactory,
    private readonly writer: AutoWatermarkJobWriter,
    private readonly queue: AutoWatermarkJobQueue,
  ) {}

  async execute(input: {
    shopDomain: string;
    productId: string;
    trigger: Extract<AutoWatermarkTrigger, "NEW_PRODUCT" | "PRIMARY_CHANGED">;
  }): Promise<EvaluationResult> {
    const rules = (await this.rules.listByShop(input.shopDomain))
      .filter((rule) => rule.enabled)
      .sort(compareRules);
    // Không rule nào hành động với trigger này thì khỏi gọi Shopify.
    if (!rules.some((rule) => rule.acts(input.trigger))) {
      return { outcome: "NO_ACTIVE_RULE" };
    }

    const product = await this.products.findProduct(input.shopDomain, input.productId);
    if (!product) return { outcome: "PRODUCT_NOT_FOUND" };

    const owner = await this.findOwner(rules, input.shopDomain, product);
    if (!owner) return { outcome: "NO_MATCHING_RULE" };
    if (!owner.acts(input.trigger)) return { outcome: "OWNER_INACTIVE", ruleId: owner.id };

    const decision = decideAutoWatermark(owner, product, input.trigger);
    if (!decision.create) {
      return { outcome: "SKIPPED", ruleId: owner.id, reason: decision.reason };
    }

    const { jobIds } = await this.writer.createJobs({
      rule: owner,
      products: [product],
      asBatch: false,
    });
    const jobId = jobIds[0];
    if (!jobId) throw new Error("Không tạo được job auto-watermark");
    await this.queue.enqueueJob(jobId, input.shopDomain);
    return { outcome: "CREATED", ruleId: owner.id, jobId };
  }

  private async findOwner(
    rules: AutoWatermarkRule[],
    shopDomain: string,
    product: { shopifyProductId: string; productType: string },
  ): Promise<AutoWatermarkRule | null> {
    let collections: ShopCollections | null = null;
    for (const rule of rules) {
      let matches = rule.matchesStatically(product);
      if (matches === null) {
        collections ??= await this.collections.forShop(shopDomain);
        matches = await collections.isInCollection(product.shopifyProductId, rule.scopeValue!);
      }
      if (matches) return rule;
    }
    return null;
  }
}
