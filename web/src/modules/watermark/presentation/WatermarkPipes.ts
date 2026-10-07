import { BadRequestException, Injectable, type PipeTransform } from "@nestjs/common";
import type { WatermarkBatchSelection } from "../application/BulkWatermarkPorts.ts";
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

@Injectable()
export class BatchSelectionPipe implements PipeTransform {
  transform(body: Record<string, unknown>): WatermarkBatchSelection {
    const hasIds = body.productIds !== undefined;
    const hasType = body.productType !== undefined;
    if (hasIds === hasType) {
      throw new BadRequestException({
        error: "Cần gửi đúng một trong hai: productIds hoặc productType",
      });
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
