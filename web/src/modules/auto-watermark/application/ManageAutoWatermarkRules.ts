import { randomUUID } from "node:crypto";
import {
  WatermarkDesign,
  type WatermarkLayerProps,
} from "../../watermark/domain/WatermarkDesign.ts";
import {
  compareRules,
  AutoWatermarkRule,
  type AutoWatermarkScope,
} from "../domain/AutoWatermarkRule.ts";
import type {
  AutoWatermarkApplyQueue,
  AutoWatermarkRuleRepository,
  ShopCollectionsFactory,
  WatermarkDesignStore,
} from "./AutoWatermarkPorts.ts";

export interface RuleSettingsInput {
  name: string;
  enabled: boolean;
  priority: number;
  scope: AutoWatermarkScope;
  scopeValue: string | null;
  onNewProduct: boolean;
  onPrimaryChanged: boolean;
  syncScope: boolean;
  autoPublish: boolean;
}

export interface RuleWithDesign {
  rule: AutoWatermarkRule;
  design: WatermarkDesign | null;
}

export class ManageAutoWatermarkRules {
  constructor(
    private readonly rules: AutoWatermarkRuleRepository,
    private readonly designs: WatermarkDesignStore,
    private readonly collections: ShopCollectionsFactory,
    private readonly applyQueue: AutoWatermarkApplyQueue,
  ) {}

  async list(shopDomain: string): Promise<RuleWithDesign[]> {
    const rules = (await this.rules.listByShop(shopDomain)).sort(compareRules);
    const designs = await this.designs.findByIds([...new Set(rules.map((rule) => rule.designId))]);
    return rules.map((rule) => ({ rule, design: designs.get(rule.designId) ?? null }));
  }

  async create(input: RuleSettingsInput & {
    shopDomain: string;
    layers: ReadonlyArray<WatermarkLayerProps>;
    applyNow: boolean;
  }): Promise<AutoWatermarkRule> {
    const design = new WatermarkDesign(input.layers);
    // Kiểm tra rule trước khi gọi Shopify và lưu design, để input sai không để
    // lại design rác hay gửi GID hỏng lên Shopify.
    const draft = new AutoWatermarkRule({
      ...input,
      id: randomUUID(),
      scopeLabel: null,
      designId: "pending",
    });
    const rule = draft.with({
      scopeLabel: await this.scopeLabel(input.shopDomain, draft.scope, draft.scopeValue),
      designId: await this.designs.save(input.shopDomain, design),
    });
    await this.rules.save(rule);
    if (input.applyNow && rule.enabled) {
      await this.applyQueue.requestApply({ shopDomain: rule.shopDomain, trigger: "MANUAL", ruleId: rule.id });
    }
    return rule;
  }

  async update(input: Partial<RuleSettingsInput> & {
    id: string;
    shopDomain: string;
    layers?: ReadonlyArray<WatermarkLayerProps>;
  }): Promise<AutoWatermarkRule> {
    const current = await this.require(input.id, input.shopDomain);
    const { id: _id, shopDomain, layers, ...settings } = input;
    const scopeChanged =
      (settings.scope !== undefined && settings.scope !== current.scope) ||
      (settings.scopeValue !== undefined && settings.scopeValue !== current.scopeValue);
    const design = layers ? new WatermarkDesign(layers) : null;

    let next = current.with({
      ...stripUndefined(settings),
      scopeLabel: scopeChanged ? null : current.scopeLabel,
    });
    if (scopeChanged) {
      next = next.with({ scopeLabel: await this.scopeLabel(shopDomain, next.scope, next.scopeValue) });
    }
    if (design) {
      next = next.with({ designId: await this.designs.save(shopDomain, design) });
    }
    await this.rules.save(next);
    return next;
  }

  async delete(id: string, shopDomain: string): Promise<void> {
    await this.require(id, shopDomain);
    await this.rules.delete(id, shopDomain);
  }

  async apply(id: string, shopDomain: string): Promise<void> {
    const rule = await this.require(id, shopDomain);
    if (!rule.enabled) throw new Error("Hãy bật rule trước khi áp dụng");
    await this.applyQueue.requestApply({ shopDomain, trigger: "MANUAL", ruleId: rule.id });
  }

  private async require(id: string, shopDomain: string): Promise<AutoWatermarkRule> {
    const rule = await this.rules.findById(id, shopDomain);
    if (!rule) throw new Error("Không tìm thấy rule");
    return rule;
  }

  /** Tên collection lấy từ Shopify, đồng thời xác nhận collection tồn tại. */
  private async scopeLabel(
    shopDomain: string,
    scope: AutoWatermarkScope,
    scopeValue: string | null,
  ): Promise<string | null> {
    if (scope !== "COLLECTION") return scopeValue;
    if (!scopeValue) throw new Error("Hãy chọn collection");
    const collections = await this.collections.forShop(shopDomain);
    const title = await collections.getCollectionTitle(scopeValue);
    if (title === null) throw new Error("Không tìm thấy collection trên Shopify");
    return title;
  }
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as Partial<T>;
}
