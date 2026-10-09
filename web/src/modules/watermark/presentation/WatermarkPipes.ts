import { BadRequestException, Injectable, type PipeTransform } from "@nestjs/common";
import type { WatermarkBatchSelection } from "../application/BulkWatermarkPorts.ts";
import { parseCatalogFilter, type CatalogFilter } from "../domain/CatalogFilter.ts";
import {
  MAX_WATERMARK_LAYERS,
  toLayerProps,
  type WatermarkLayerProps,
} from "../domain/WatermarkDesign.ts";

/**
 * Nhận `{ layers: [...] }`. Body phẳng kiểu cũ (một cấu hình, `watermarkType`
 * hoặc `type`) được hiểu là design có một lớp. Luật nghiệp vụ (giá trị hợp lệ,
 * giới hạn số lớp logo/tiled) do WatermarkDesign kiểm tra.
 */
@Injectable()
export class WatermarkLayersPipe implements PipeTransform {
  transform(body: Record<string, unknown>): WatermarkLayerProps[] {
    if (body.layers === undefined) return [toLayerProps(body)];
    if (!Array.isArray(body.layers)) {
      throw new BadRequestException({ error: "layers phải là một mảng" });
    }
    if (body.layers.length > MAX_WATERMARK_LAYERS) {
      throw new BadRequestException({
        error: `Thiết kế watermark tối đa ${MAX_WATERMARK_LAYERS} lớp`,
      });
    }
    return body.layers.map((layer, index) => {
      if (!layer || typeof layer !== "object" || Array.isArray(layer)) {
        throw new BadRequestException({ error: `Lớp ${index + 1} không hợp lệ` });
      }
      return toLayerProps(layer as Record<string, unknown>);
    });
  }
}

/** `?page=&pageSize=` của danh sách phân trang; thiếu thì trang 1 với cỡ mặc định. */
export function parsePageQuery(
  query: Record<string, unknown>,
  defaultPageSize: number,
  maxPageSize: number
): { page: number; pageSize: number } {
  const page = positiveIntegerParam(query.page, 1, "page");
  const pageSize = positiveIntegerParam(query.pageSize, defaultPageSize, "pageSize");
  if (pageSize > maxPageSize) {
    throw new BadRequestException({ error: `pageSize tối đa ${maxPageSize}` });
  }
  return { page, pageSize };
}

/** Bộ lọc sản phẩm gửi qua query string (?scope=&productType=&collectionId=&search=). */
export function parseCatalogFilterQuery(query: Record<string, unknown>): CatalogFilter {
  try {
    return parseCatalogFilter({
      scope: query.scope,
      productType: query.productType,
      collectionId: query.collectionId,
      search: query.search,
    });
  } catch (error) {
    throw new BadRequestException({
      error: error instanceof Error ? error.message : "Bộ lọc sản phẩm không hợp lệ",
    });
  }
}

function positiveIntegerParam(value: unknown, fallback: number, name: string): number {
  if (value === undefined || value === "") return fallback;
  const parsed = typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new BadRequestException({ error: `${name} phải là số nguyên dương` });
  }
  return parsed;
}

/** Chọn sản phẩm cụ thể/loại/collection, hoặc "tất cả sản phẩm khớp bộ lọc". */
export type BatchRequestSelection =
  | WatermarkBatchSelection
  | { kind: "FILTER"; filter: CatalogFilter };

@Injectable()
export class BatchSelectionPipe implements PipeTransform {
  transform(body: Record<string, unknown>): BatchRequestSelection {
    const hasIds = body.productIds !== undefined;
    const hasType = body.productType !== undefined;
    const hasCollection = body.collectionId !== undefined;
    const hasFilter = body.filter !== undefined;
    if ([hasIds, hasType, hasCollection, hasFilter].filter(Boolean).length !== 1) {
      throw new BadRequestException({
        error: "Cần gửi đúng một trong bốn: productIds, productType, collectionId hoặc filter",
      });
    }
    if (hasFilter) {
      try {
        return { kind: "FILTER", filter: parseCatalogFilter(body.filter) };
      } catch (error) {
        throw new BadRequestException({
          error: error instanceof Error ? error.message : "Bộ lọc sản phẩm không hợp lệ",
        });
      }
    }
    if (hasCollection) {
      if (typeof body.collectionId !== "string") {
        throw new BadRequestException({ error: "collectionId phải là chuỗi" });
      }
      return { kind: "COLLECTION", collectionId: body.collectionId };
    }
    if (hasType) {
      if (typeof body.productType !== "string") {
        throw new BadRequestException({ error: "productType phải là chuỗi" });
      }
      return { kind: "PRODUCT_TYPE", productType: body.productType };
    }
    if (!Array.isArray(body.productIds)) {
      throw new BadRequestException({ error: "productIds phải là một mảng" });
    }
    return { kind: "PRODUCT_IDS", productIds: body.productIds.map(String) };
  }
}
