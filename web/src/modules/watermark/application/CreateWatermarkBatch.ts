import {
  WatermarkDesign,
  type WatermarkLayerProps,
} from "../domain/WatermarkDesign.ts";
import type {
  CollectionProductLookup,
  CreatedWatermarkBatch,
  ResolvedBatchSelection,
  WatermarkBatchRepository,
  WatermarkBatchSelection,
} from "./BulkWatermarkPorts.ts";
import type { DispatchWatermarkBatch } from "./DispatchWatermarkBatch.ts";

const MAX_SELECTED_PRODUCTS = 1_000;
/** Watermark cả một loại sản phẩm hoặc cả một collection. */
const MAX_GROUP_JOBS = 5_000;

export interface CreateWatermarkBatchInput {
  shopDomain: string;
  selection: WatermarkBatchSelection;
  layers: ReadonlyArray<WatermarkLayerProps>;
}

export class CreateWatermarkBatch {
  constructor(
    private readonly repository: WatermarkBatchRepository,
    private readonly dispatcher: Pick<DispatchWatermarkBatch, "execute">,
    private readonly collections: CollectionProductLookup
  ) {}

  async execute(
    input: CreateWatermarkBatchInput
  ): Promise<CreatedWatermarkBatch> {
    if (!input.shopDomain.trim()) {
      throw new Error("Shop domain không được để trống");
    }

    // Kiểm tra design trước khi gọi Shopify lấy sản phẩm của collection.
    const design = new WatermarkDesign(input.layers);
    const selection = await this.resolve(
      input.shopDomain,
      normalizeSelection(input.selection)
    );
    const batch = await this.repository.create({
      shopDomain: input.shopDomain,
      selection,
      maxJobs:
        selection.kind === "PRODUCT_IDS" ? MAX_SELECTED_PRODUCTS : MAX_GROUP_JOBS,
      design,
    });

    // Đưa phần vừa với cửa sổ còn trống của shop vào queue (batch nhỏ thường
    // vào hết ngay); phần còn lại được nhỏ giọt khi từng job hoàn thành.
    await this.dispatcher.execute(batch.id);
    return batch;
  }

  private async resolve(
    shopDomain: string,
    selection: WatermarkBatchSelection
  ): Promise<ResolvedBatchSelection> {
    if (selection.kind !== "COLLECTION") return selection;
    const productIds = await this.collections.listProductIds(
      shopDomain,
      selection.collectionId
    );
    if (productIds === null) {
      throw new Error("Không tìm thấy collection trên Shopify");
    }
    if (productIds.length === 0) {
      throw new Error("Collection chưa có sản phẩm nào");
    }
    return { kind: "COLLECTION", collectionId: selection.collectionId, productIds };
  }
}

function normalizeSelection(
  selection: WatermarkBatchSelection
): WatermarkBatchSelection {
  if (selection.kind === "PRODUCT_TYPE") {
    return { kind: "PRODUCT_TYPE", productType: selection.productType.trim() };
  }
  if (selection.kind === "COLLECTION") {
    const collectionId = selection.collectionId.trim();
    if (!/^gid:\/\/shopify\/Collection\/\d+$/.test(collectionId)) {
      throw new Error("Collection không hợp lệ");
    }
    return { kind: "COLLECTION", collectionId };
  }

  const productIds = [
    ...new Set(selection.productIds.map((id) => id.trim())),
  ].filter(Boolean);
  if (productIds.length === 0) {
    throw new Error("Hãy chọn ít nhất một sản phẩm");
  }
  if (productIds.length > MAX_SELECTED_PRODUCTS) {
    throw new Error("Mỗi batch chỉ hỗ trợ tối đa 1.000 sản phẩm");
  }
  return { kind: "PRODUCT_IDS", productIds };
}
