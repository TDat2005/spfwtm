import {
  decideAutoWatermark,
  type AutoWatermarkSkipReason,
  type ProductAutoState,
} from "../domain/AutoWatermarkDecision.ts";
import { compareRules, type AutoWatermarkRule } from "../domain/AutoWatermarkRule.ts";
import type {
  AutoWatermarkJobQueue,
  AutoWatermarkJobWriter,
  AutoWatermarkRestoreQueue,
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
  /** Sản phẩm đã rời phạm vi và được yêu cầu gỡ ảnh watermark của rule. */
  restoredProducts: number;
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
 * Rule bật `restoreOnLeave`: sản phẩm còn ảnh watermark của rule trên Shopify
 * nhưng không còn thuộc rule (rời collection, đổi loại, bị rule ưu tiên hơn giành)
 * thì được gỡ ảnh đó.
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
    private readonly restoreQueue: AutoWatermarkRestoreQueue,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: ApplyAutoWatermarkInput): Promise<RuleApplySummary[]> {
    const rules = (await this.rules.listByShop(input.shopDomain))
      .filter((rule) => rule.enabled)
      .sort(compareRules);
    const inThisRun = (rule: AutoWatermarkRule) =>
      input.trigger === "SYNC" || rule.id === input.ruleId;
    const acting = new Set(
      rules
        .filter((rule) => inThisRun(rule) && rule.acts(input.trigger))
        .map((rule) => rule.id)
    );
    const leaving = new Set(
      rules.filter((rule) => inThisRun(rule) && rule.restoreOnLeave).map((rule) => rule.id)
    );
    if (input.trigger === "MANUAL" && acting.size === 0) {
      throw new Error("Rule không tồn tại hoặc đang tắt");
    }
    const involved = new Set([...acting, ...leaving]);
    if (involved.size === 0) return [];

    // Rule thấp hơn rule cuối cùng tham gia lượt này không ảnh hưởng ai sở hữu sản phẩm nào.
    let lastIndex = -1;
    rules.forEach((rule, index) => {
      if (involved.has(rule.id)) lastIndex = index;
    });
    const products = await this.products.listProducts(input.shopDomain);
    const byShopifyId = new Map(products.map((product) => [product.shopifyProductId, product]));
    const claimed = new Set<string>();
    let collections: ShopCollections | null = null;
    const summaries: RuleApplySummary[] = [];

    for (const rule of rules.slice(0, lastIndex + 1)) {
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
      if (!involved.has(rule.id)) continue;

      const summary = acting.has(rule.id)
        ? await this.applyRule(rule, owned, input.trigger)
        : emptySummary(rule, owned.length);
      summary.notInCatalog = notInCatalog;
      summary.collectionMissing = collectionMissing;
      // Collection bị xóa: không biết thật sự sản phẩm nào đã rời, nên không gỡ gì.
      if (leaving.has(rule.id) && !collectionMissing) {
        summary.restoredProducts = await this.restoreLeftProducts(
          input.shopDomain,
          rule,
          products,
          new Set(owned.map((product) => product.catalogProductId)),
        );
      }
      summaries.push(summary);
    }

    await this.rules.markApplied([...involved], this.now());
    return summaries;
  }

  private async applyRule(
    rule: AutoWatermarkRule,
    owned: ProductAutoState[],
    trigger: ApplyAutoWatermarkInput["trigger"],
  ): Promise<RuleApplySummary> {
    const summary = emptySummary(rule, owned.length);
    const toCreate: ProductAutoState[] = [];
    for (const product of owned) {
      const decision = decideAutoWatermark(rule, product, trigger);
      if (decision.create) toCreate.push(product);
      else summary.skipped[decision.reason] += 1;
    }

    if (toCreate.length > 0) {
      const { batchId } = await this.writer.createJobs({ rule, products: toCreate, asBatch: true });
      summary.batchId = batchId;
      summary.createdJobs = toCreate.length;
      if (batchId) await this.queue.dispatchBatch(batchId);
    }
    return summary;
  }

  private async restoreLeftProducts(
    shopDomain: string,
    rule: AutoWatermarkRule,
    products: ProductAutoState[],
    ownedIds: ReadonlySet<string>,
  ): Promise<number> {
    const left = products.filter(
      (product) =>
        !ownedIds.has(product.catalogProductId) &&
        product.publishedByRules.some((published) => published.ruleId === rule.id)
    );
    if (left.length === 0) return 0;

    // Xóa trạng thái trước: nếu xếp job gỡ ảnh thất bại, ảnh vẫn còn nên đêm sau
    // sẽ phát hiện lại; làm ngược lại thì sản phẩm quay về phạm vi sẽ không được đóng dấu.
    await this.writer.clearAutoState(
      left.map((product) => product.catalogProductId),
      rule.id,
    );
    await this.restoreQueue.requestRestore({
      shopDomain,
      watermarkJobIds: left.flatMap((product) =>
        product.publishedByRules
          .filter((published) => published.ruleId === rule.id)
          .map((published) => published.watermarkJobId)
      ),
    });
    return left.length;
  }
}

function emptySummary(rule: AutoWatermarkRule, ownedProducts: number): RuleApplySummary {
  return {
    ruleId: rule.id,
    ruleName: rule.name,
    ownedProducts,
    createdJobs: 0,
    batchId: null,
    skipped: { NO_IMAGE: 0, ALREADY_APPLIED: 0, MANUAL_WATERMARK: 0 },
    notInCatalog: 0,
    collectionMissing: false,
    restoredProducts: 0,
  };
}
