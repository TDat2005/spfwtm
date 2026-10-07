import {
  WatermarkConfiguration,
  type WatermarkConfigurationProps,
  type WatermarkType,
} from "./WatermarkConfiguration.ts";

/**
 * File này không import gì từ Node để frontend dùng chung giới hạn và cách đọc
 * template (giống WatermarkGeometry).
 */
export const MAX_WATERMARK_LAYERS = 10;
export const MAX_LOGO_LAYERS = 3;
export const MAX_TILED_LAYERS = 3;
export const WATERMARK_DESIGN_VERSION = 2;

export interface WatermarkLayerProps extends WatermarkConfigurationProps {
  enabled?: boolean;
}

export interface WatermarkLayer {
  readonly enabled: boolean;
  readonly configuration: WatermarkConfiguration;
}

/** Dạng lưu trong DB/template; luôn đủ field để so sánh hash ổn định. */
export interface SerializedWatermarkLayer {
  enabled: boolean;
  type: WatermarkType;
  text: string | null;
  logoUrl: string | null;
  logoScale: number;
  position: WatermarkConfiguration["position"];
  opacity: number;
  layout: WatermarkConfiguration["layout"];
  rotation: number;
  offsetX: number;
  offsetY: number;
  fontFamily: WatermarkConfiguration["fontFamily"];
  fontSize: number;
  textColor: string;
  strokeColor: string;
  strokeWidth: number;
}

export interface SerializedWatermarkDesign {
  version: typeof WATERMARK_DESIGN_VERSION;
  layers: SerializedWatermarkLayer[];
}

/**
 * Value Object: danh sách layer có thứ tự. Layer đầu nằm dưới cùng, layer sau
 * chồng lên layer trước. Bất biến — sửa thiết kế nghĩa là tạo design mới, nhờ
 * vậy job đang chạy không bị đổi cấu hình giữa chừng.
 */
export class WatermarkDesign {
  readonly layers: readonly WatermarkLayer[];

  constructor(layers: ReadonlyArray<WatermarkLayerProps | WatermarkLayer>) {
    if (layers.length === 0) {
      throw new Error("Thiết kế watermark phải có ít nhất một lớp");
    }
    if (layers.length > MAX_WATERMARK_LAYERS) {
      throw new Error(`Thiết kế watermark tối đa ${MAX_WATERMARK_LAYERS} lớp`);
    }

    this.layers = Object.freeze(
      layers.map((layer, index) => {
        if (isLayer(layer)) return layer;
        try {
          return Object.freeze({
            enabled: layer.enabled ?? true,
            configuration: new WatermarkConfiguration(layer),
          });
        } catch (error) {
          throw new Error(`Lớp ${index + 1}: ${errorMessage(error)}`);
        }
      })
    );

    const active = this.activeLayers;
    if (active.length === 0) {
      throw new Error("Cần bật ít nhất một lớp watermark");
    }
    if (active.filter((layer) => layer.type === "IMAGE").length > MAX_LOGO_LAYERS) {
      throw new Error(`Tối đa ${MAX_LOGO_LAYERS} lớp logo đang bật`);
    }
    if (active.filter((layer) => layer.layout === "TILED").length > MAX_TILED_LAYERS) {
      throw new Error(`Tối đa ${MAX_TILED_LAYERS} lớp lặp toàn ảnh (Tiled) đang bật`);
    }
  }

  /** Các lớp sẽ được render, theo thứ tự từ dưới lên. */
  get activeLayers(): WatermarkConfiguration[] {
    return this.layers
      .filter((layer) => layer.enabled)
      .map((layer) => layer.configuration);
  }

  /** URL logo cần tải (mỗi URL một lần dù nhiều lớp dùng chung). */
  get logoUrls(): string[] {
    return [
      ...new Set(
        this.activeLayers.flatMap((layer) =>
          layer.type === "IMAGE" && layer.logoUrl ? [layer.logoUrl] : []
        )
      ),
    ];
  }

  /** Mô tả ngắn cho lịch sử job, ví dụ: `"© My Store" + Logo`. */
  get summary(): string {
    return this.activeLayers
      .map((layer) => (layer.type === "IMAGE" ? "Logo" : `"${layer.text}"`))
      .join(" + ");
  }

  toJSON(): SerializedWatermarkDesign {
    return {
      version: WATERMARK_DESIGN_VERSION,
      layers: this.layers.map(({ enabled, configuration: c }) => ({
        enabled,
        type: c.type,
        text: c.text,
        logoUrl: c.logoUrl,
        logoScale: c.logoScale,
        position: c.position,
        opacity: c.opacity,
        layout: c.layout,
        rotation: c.rotation,
        offsetX: c.offsetX,
        offsetY: c.offsetY,
        fontFamily: c.fontFamily,
        fontSize: c.fontSize,
        textColor: c.textColor,
        strokeColor: c.strokeColor,
        strokeWidth: c.strokeWidth,
      })),
    };
  }

  /**
   * Đọc design từ JSON đã lưu hoặc body/template cũ:
   * - v2: `{ version: 2, layers: [...] }` hoặc `{ layers: [...] }`
   * - v1: một cấu hình phẳng (`watermarkType`/`type`, `text`, `position`...)
   */
  static fromJSON(raw: unknown): WatermarkDesign {
    const value = typeof raw === "string" ? parseJson(raw) : raw;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Thiết kế watermark không hợp lệ");
    }
    const record = value as Record<string, unknown>;
    const layers = Array.isArray(record.layers) ? record.layers : [record];
    return new WatermarkDesign(
      layers.map((layer) => toLayerProps(layer as Record<string, unknown>))
    );
  }
}

/** Chuẩn hóa một layer từ JSON tùy ý (template v1 dùng `watermarkType`). */
export function toLayerProps(raw: Record<string, unknown>): WatermarkLayerProps {
  const type = raw.type ?? raw.watermarkType;
  return {
    enabled: raw.enabled === undefined ? true : raw.enabled !== false,
    type: type === "IMAGE" ? "IMAGE" : "TEXT",
    text: optionalString(raw.text),
    logoUrl: optionalString(raw.logoUrl),
    logoScale: optionalNumber(raw.logoScale),
    position: (optionalString(raw.position) ?? "BOTTOM_RIGHT") as WatermarkLayerProps["position"],
    opacity: optionalNumber(raw.opacity) ?? 0.7,
    layout: (optionalString(raw.layout) ?? undefined) as WatermarkLayerProps["layout"],
    rotation: optionalNumber(raw.rotation),
    offsetX: optionalNumber(raw.offsetX),
    offsetY: optionalNumber(raw.offsetY),
    fontFamily: (optionalString(raw.fontFamily) ?? undefined) as WatermarkLayerProps["fontFamily"],
    fontSize: optionalNumber(raw.fontSize),
    textColor: optionalString(raw.textColor) ?? undefined,
    strokeColor: optionalString(raw.strokeColor) ?? undefined,
    strokeWidth: optionalNumber(raw.strokeWidth),
  };
}

function isLayer(value: WatermarkLayerProps | WatermarkLayer): value is WatermarkLayer {
  return "configuration" in value && value.configuration instanceof WatermarkConfiguration;
}

function optionalString(value: unknown): string | null {
  return value === undefined || value === null ? null : String(value);
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return Number(value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Thiết kế watermark không phải JSON hợp lệ");
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
