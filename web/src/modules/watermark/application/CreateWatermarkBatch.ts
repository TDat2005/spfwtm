import {
  WatermarkDesign,
  type WatermarkLayerProps,
} from "../domain/WatermarkDesign.ts";
import type {
  CreatedWatermarkBatch,
  WatermarkBatchRepository,
  WatermarkBatchSelection,
} from "./BulkWatermarkPorts.ts";
import type { DispatchWatermarkBatch } from "./DispatchWatermarkBatch.ts";

const MAX_SELECTED_PRODUCTS = 1_000;
const MAX_PRODUCT_TYPE_JOBS = 5_000;

export interface CreateWatermarkBatchInput {
  shopDomain: string;
  selection: WatermarkBatchSelection;
  layers: ReadonlyArray<WatermarkLayerProps>;
}

export class CreateWatermarkBatch {
  constructor(
    private readonly repository: WatermarkBatchRepository,
    private readonly dispatcher: Pick<DispatchWatermarkBatch, "execute">
  ) {}

  async execute(
    input: CreateWatermarkBatchInput
  ): Promise<CreatedWatermarkBatch> {
    if (!input.shopDomain.trim()) {
      throw new Error("Shop domain không được để trống");
    }

    const selection = normalizeSelection(input.selection);
    const batch = await this.repository.create({
      shopDomain: input.shopDomain,
      selection,
      maxJobs:
        selection.kind === "PRODUCT_IDS"
          ? MAX_SELECTED_PRODUCTS
          : MAX_PRODUCT_TYPE_JOBS,
      design: new WatermarkDesign(input.layers),
    });

    // Batch nhỏ vào lane interactive ngay; batch lớn chỉ đưa cửa sổ đầu tiên,
    // phần còn lại được nhỏ giọt khi từng job hoàn thành.
    await this.dispatcher.execute(batch.id);
    return batch;
  }
}

function normalizeSelection(
  selection: WatermarkBatchSelection
): WatermarkBatchSelection {
  if (selection.kind === "PRODUCT_TYPE") {
    return { kind: "PRODUCT_TYPE", productType: selection.productType.trim() };
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
