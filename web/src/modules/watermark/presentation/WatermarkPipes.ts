import { BadRequestException, Injectable, type PipeTransform } from "@nestjs/common";
import type { WatermarkBatchSelection } from "../application/BulkWatermarkPorts.ts";
import type {
  WatermarkFontFamily,
  WatermarkLayout,
  WatermarkPosition,
} from "../domain/WatermarkJob.ts";

const positions = new Set<WatermarkPosition>([
  "TOP_LEFT", "TOP_CENTER", "TOP_RIGHT", "MIDDLE_LEFT", "CENTER",
  "MIDDLE_RIGHT", "BOTTOM_LEFT", "BOTTOM_CENTER", "BOTTOM_RIGHT",
]);
const layouts = new Set<WatermarkLayout>(["SINGLE", "TILED"]);

export type WatermarkConfigurationInput = ReturnType<WatermarkConfigurationPipe["transform"]>;

@Injectable()
export class WatermarkConfigurationPipe implements PipeTransform {
  transform(body: Record<string, unknown>) {
    const position = String(body.position ?? "BOTTOM_RIGHT") as WatermarkPosition;
    if (!positions.has(position)) {
      throw new BadRequestException({ error: "Vị trí watermark không hợp lệ" });
    }
    const layout = String(body.layout ?? "SINGLE") as WatermarkLayout;
    if (!layouts.has(layout)) {
      throw new BadRequestException({ error: "Kiểu bố trí watermark không hợp lệ" });
    }
    return {
      type: body.watermarkType === "IMAGE" ? ("IMAGE" as const) : ("TEXT" as const),
      text: body.text !== undefined && body.text !== null ? String(body.text) : null,
      logoUrl: body.logoUrl !== undefined && body.logoUrl !== null ? String(body.logoUrl) : null,
      logoScale: Number(body.logoScale ?? 0.2),
      position,
      opacity: Number(body.opacity ?? 0.7),
      layout,
      rotation: Number(body.rotation ?? 0),
      offsetX: Number(body.offsetX ?? 0),
      offsetY: Number(body.offsetY ?? 0),
      fontFamily: String(body.fontFamily ?? "Arial") as WatermarkFontFamily,
      fontSize: Number(body.fontSize ?? 0.045),
      textColor: String(body.textColor ?? "#FFFFFF"),
      strokeColor: String(body.strokeColor ?? "#000000"),
      strokeWidth: Number(body.strokeWidth ?? 2),
    };
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
