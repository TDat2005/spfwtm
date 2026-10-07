export const AUTO_WATERMARK_SCOPES = ["ALL", "COLLECTION", "PRODUCT_TYPE"] as const;
export type AutoWatermarkScope = (typeof AUTO_WATERMARK_SCOPES)[number];

/**
 * Lúc nào rule được xét:
 * - NEW_PRODUCT: sản phẩm có ảnh chính lần đầu (webhook).
 * - PRIMARY_CHANGED: merchant đổi ảnh chính (webhook).
 * - SYNC: đồng bộ định kỳ cho sản phẩm đang nằm trong phạm vi.
 * - MANUAL: merchant bấm "Áp dụng ngay" cho một rule.
 */
export type AutoWatermarkTrigger = "NEW_PRODUCT" | "PRIMARY_CHANGED" | "SYNC" | "MANUAL";

export const MIN_RULE_PRIORITY = -1000;
export const MAX_RULE_PRIORITY = 1000;

export interface AutoWatermarkRuleProps {
  id: string;
  shopDomain: string;
  name: string;
  enabled: boolean;
  priority: number;
  scope: AutoWatermarkScope;
  scopeValue: string | null;
  scopeLabel: string | null;
  designId: string;
  onNewProduct: boolean;
  onPrimaryChanged: boolean;
  syncScope: boolean;
  autoPublish: boolean;
  lastAppliedAt?: Date | null;
  createdAt?: Date;
}

export interface RuleScopeFacts {
  productType: string;
}

/**
 * Một sản phẩm thuộc về đúng MỘT rule: rule đang bật, có độ ưu tiên cao nhất
 * và có phạm vi khớp với sản phẩm. Trigger chỉ quyết định KHI NÀO rule sở hữu
 * hành động. Nhờ vậy hai rule không bao giờ thay phiên đóng dấu cùng một sản
 * phẩm (rule A áp khi tạo mới, rule B đồng bộ đêm lại đè lên...).
 */
export class AutoWatermarkRule {
  readonly id: string;
  readonly shopDomain: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly priority: number;
  readonly scope: AutoWatermarkScope;
  readonly scopeValue: string | null;
  readonly scopeLabel: string | null;
  readonly designId: string;
  readonly onNewProduct: boolean;
  readonly onPrimaryChanged: boolean;
  readonly syncScope: boolean;
  readonly autoPublish: boolean;
  readonly lastAppliedAt: Date | null;
  readonly createdAt: Date;

  constructor(props: AutoWatermarkRuleProps) {
    if (!props.id.trim()) throw new Error("Rule ID không được để trống");
    if (!props.shopDomain.trim()) throw new Error("Shop domain không được để trống");
    const name = props.name.trim();
    if (!name) throw new Error("Tên rule không được để trống");
    if (name.length > 255) throw new Error("Tên rule tối đa 255 ký tự");
    if (
      !Number.isInteger(props.priority) ||
      props.priority < MIN_RULE_PRIORITY ||
      props.priority > MAX_RULE_PRIORITY
    ) {
      throw new Error(
        `Độ ưu tiên phải là số nguyên từ ${MIN_RULE_PRIORITY} đến ${MAX_RULE_PRIORITY}`
      );
    }
    if (!AUTO_WATERMARK_SCOPES.includes(props.scope)) {
      throw new Error("Phạm vi rule không hợp lệ");
    }
    if (!props.designId.trim()) throw new Error("Rule phải có thiết kế watermark");

    this.id = props.id;
    this.shopDomain = props.shopDomain;
    this.name = name;
    this.enabled = props.enabled;
    this.priority = props.priority;
    this.scope = props.scope;
    this.scopeValue = normalizeScopeValue(props.scope, props.scopeValue);
    this.scopeLabel =
      props.scope === "ALL" ? null : props.scopeLabel?.trim() || this.scopeValue;
    this.designId = props.designId;
    this.onNewProduct = props.onNewProduct;
    this.onPrimaryChanged = props.onPrimaryChanged;
    this.syncScope = props.syncScope;
    this.autoPublish = props.autoPublish;
    this.lastAppliedAt = props.lastAppliedAt ?? null;
    this.createdAt = props.createdAt ?? new Date();
  }

  /** Rule có hành động với trigger này không (khi nó là rule sở hữu sản phẩm). */
  acts(trigger: AutoWatermarkTrigger): boolean {
    if (!this.enabled) return false;
    switch (trigger) {
      case "NEW_PRODUCT":
        return this.onNewProduct;
      case "PRIMARY_CHANGED":
        return this.onPrimaryChanged;
      case "SYNC":
        return this.syncScope;
      case "MANUAL":
        return true;
    }
  }

  /**
   * Khớp phạm vi mà không cần gọi Shopify. Trả về null với rule COLLECTION:
   * phải hỏi Shopify (`product.inCollection`) hoặc liệt kê sản phẩm của collection.
   */
  matchesStatically(product: RuleScopeFacts): boolean | null {
    switch (this.scope) {
      case "ALL":
        return true;
      case "PRODUCT_TYPE":
        return product.productType.trim() === this.scopeValue;
      case "COLLECTION":
        return null;
    }
  }

  with(changes: Partial<Omit<AutoWatermarkRuleProps, "id" | "shopDomain" | "createdAt">>) {
    return new AutoWatermarkRule({ ...this.toProps(), ...changes });
  }

  toProps(): AutoWatermarkRuleProps {
    return {
      id: this.id,
      shopDomain: this.shopDomain,
      name: this.name,
      enabled: this.enabled,
      priority: this.priority,
      scope: this.scope,
      scopeValue: this.scopeValue,
      scopeLabel: this.scopeLabel,
      designId: this.designId,
      onNewProduct: this.onNewProduct,
      onPrimaryChanged: this.onPrimaryChanged,
      syncScope: this.syncScope,
      autoPublish: this.autoPublish,
      lastAppliedAt: this.lastAppliedAt,
      createdAt: this.createdAt,
    };
  }
}

/** Thứ tự xét rule: ưu tiên cao trước; bằng nhau thì rule tạo trước thắng. */
export function compareRules(a: AutoWatermarkRule, b: AutoWatermarkRule): number {
  return (
    b.priority - a.priority ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    a.id.localeCompare(b.id)
  );
}

function normalizeScopeValue(scope: AutoWatermarkScope, value: string | null): string | null {
  if (scope === "ALL") return null;
  if (value === null) {
    throw new Error(
      scope === "COLLECTION" ? "Hãy chọn collection" : "Hãy chọn loại sản phẩm"
    );
  }
  const trimmed = value.trim();
  if (scope === "COLLECTION" && !/^gid:\/\/shopify\/Collection\/\d+$/.test(trimmed)) {
    throw new Error("Collection không hợp lệ");
  }
  if (trimmed.length > 255) throw new Error("Giá trị phạm vi tối đa 255 ký tự");
  // PRODUCT_TYPE cho phép "" = nhóm sản phẩm chưa phân loại.
  return trimmed;
}
