import type { WatermarkDesign } from "../../watermark/domain/WatermarkDesign.ts";
import type { ProductAutoState } from "../domain/AutoWatermarkDecision.ts";
import type { AutoWatermarkRule, AutoWatermarkTrigger } from "../domain/AutoWatermarkRule.ts";

export interface AutoWatermarkRuleRepository {
  listByShop(shopDomain: string): Promise<AutoWatermarkRule[]>;
  findById(id: string, shopDomain: string): Promise<AutoWatermarkRule | null>;
  save(rule: AutoWatermarkRule): Promise<void>;
  delete(id: string, shopDomain: string): Promise<void>;
  markApplied(ruleIds: string[], at: Date): Promise<void>;
  /** Shop có ít nhất một rule đang bật cần kiểm tra phạm vi hằng đêm (đồng bộ hoặc gỡ khi rời phạm vi). */
  listShopsWithSyncRules(): Promise<string[]>;
}

export interface ProductAutoStateReader {
  findProduct(shopDomain: string, shopifyProductId: string): Promise<ProductAutoState | null>;
  /** Mọi sản phẩm chưa bị xóa của shop. */
  listProducts(shopDomain: string): Promise<ProductAutoState[]>;
}

export interface AutoWatermarkJobWriter {
  /**
   * Tạo job cho các sản phẩm (một batch nếu `asBatch`), hủy job auto PENDING cũ
   * của chính các sản phẩm đó và ghi lại trạng thái auto của sản phẩm.
   */
  createJobs(input: {
    rule: AutoWatermarkRule;
    products: ProductAutoState[];
    asBatch: boolean;
  }): Promise<{ batchId: string | null; jobIds: string[] }>;
  /** Xóa trạng thái auto (nếu đang trỏ tới rule) để sản phẩm quay lại phạm vi thì được đóng dấu lại. */
  clearAutoState(catalogProductIds: string[], ruleId: string): Promise<void>;
}

export interface AutoWatermarkJobQueue {
  enqueueJob(jobId: string, shopDomain: string): Promise<void>;
  dispatchBatch(batchId: string): Promise<void>;
}

/** Gỡ ảnh watermark đã publish (theo job) khỏi Shopify, chạy nền vì gọi Shopify. */
export interface AutoWatermarkRestoreQueue {
  requestRestore(input: { shopDomain: string; watermarkJobIds: string[] }): Promise<void>;
}

export interface AutoWatermarkApplyQueue {
  requestApply(input: {
    shopDomain: string;
    trigger: Extract<AutoWatermarkTrigger, "SYNC" | "MANUAL">;
    ruleId?: string;
  }): Promise<void>;
}

export interface CollectionSummary {
  id: string;
  title: string;
  productsCount: number | null;
}

/** Collection của một shop, gọi Shopify Admin API bằng offline session. */
export interface ShopCollections {
  isInCollection(productId: string, collectionId: string): Promise<boolean>;
  /** null = collection không còn tồn tại. */
  listProductIds(collectionId: string): Promise<string[] | null>;
  getCollectionTitle(collectionId: string): Promise<string | null>;
  search(query: string): Promise<CollectionSummary[]>;
}

export interface ShopCollectionsFactory {
  forShop(shopDomain: string): Promise<ShopCollections>;
}

export interface WatermarkDesignStore {
  save(shopDomain: string, design: WatermarkDesign): Promise<string>;
  findByIds(ids: string[]): Promise<Map<string, WatermarkDesign>>;
}
