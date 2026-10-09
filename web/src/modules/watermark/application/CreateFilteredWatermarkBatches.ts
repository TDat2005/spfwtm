import type { CatalogFilter } from "../domain/CatalogFilter.ts";
import {
  WatermarkDesign,
  type WatermarkLayerProps,
} from "../domain/WatermarkDesign.ts";
import type {
  CatalogFilterReader,
  CollectionProductLookup,
  CreatedWatermarkBatch,
  WatermarkBatchRepository,
} from "./BulkWatermarkPorts.ts";
import type { DispatchWatermarkBatch } from "./DispatchWatermarkBatch.ts";

/** Mỗi batch tối đa ngần này job (cùng giới hạn batch theo loại/collection). */
export const FILTER_BATCH_SIZE = 5_000;
/** Chặn một lần bấm tạo quá nhiều job; bộ lọc rộng hơn thì thu hẹp lại. */
export const MAX_FILTER_JOBS = 50_000;

export interface CreateFilteredBatchesInput {
  shopDomain: string;
  filter: CatalogFilter;
  layers: ReadonlyArray<WatermarkLayerProps>;
}

/**
 * "Chọn tất cả sản phẩm khớp bộ lọc": server tự tìm sản phẩm theo đúng bộ lọc
 * merchant đang xem ngay lúc bấm (không phụ thuộc danh sách trên màn hình đang
 * tải đến đâu), rồi chia thành các batch tối đa FILTER_BATCH_SIZE job. Các
 * batch của cùng shop chạy lần lượt theo cửa sổ của shop.
 */
export class CreateFilteredWatermarkBatches {
  constructor(
    private readonly repository: WatermarkBatchRepository,
    private readonly dispatcher: Pick<DispatchWatermarkBatch, "execute">,
    private readonly collections: CollectionProductLookup,
    private readonly catalog: CatalogFilterReader,
  ) {}

  async execute(input: CreateFilteredBatchesInput): Promise<CreatedWatermarkBatch[]> {
    if (!input.shopDomain.trim()) throw new Error("Shop domain không được để trống");
    const design = new WatermarkDesign(input.layers);

    let collectionMembers: ReadonlySet<string> | null = null;
    if (input.filter.collectionId !== null) {
      const ids = await this.collections.listProductIds(input.shopDomain, input.filter.collectionId);
      if (ids === null) throw new Error("Không tìm thấy collection trên Shopify");
      collectionMembers = new Set(ids);
    }

    const productIds = await this.catalog.listMatchingProductIds(
      input.shopDomain,
      input.filter,
      collectionMembers,
    );
    if (productIds.length === 0) throw new Error("Không có sản phẩm nào khớp bộ lọc");
    if (productIds.length > MAX_FILTER_JOBS) {
      throw new Error(
        `Bộ lọc khớp ${productIds.length.toLocaleString("vi-VN")} sản phẩm, vượt ${MAX_FILTER_JOBS.toLocaleString("vi-VN")}. Hãy lọc theo loại hoặc collection.`,
      );
    }

    const batches: CreatedWatermarkBatch[] = [];
    for (let i = 0; i < productIds.length; i += FILTER_BATCH_SIZE) {
      batches.push(
        await this.repository.create({
          shopDomain: input.shopDomain,
          selection: { kind: "PRODUCT_LIST", productIds: productIds.slice(i, i + FILTER_BATCH_SIZE) },
          maxJobs: FILTER_BATCH_SIZE,
          design,
        }),
      );
    }
    // Tạo đủ các batch rồi mới đưa vào queue: batch tạo trước được chạy trước.
    for (const batch of batches) await this.dispatcher.execute(batch.id);
    return batches;
  }
}
