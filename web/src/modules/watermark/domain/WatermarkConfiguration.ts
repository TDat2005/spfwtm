export type WatermarkType = "TEXT" | "IMAGE";

export type WatermarkPosition =
  | "TOP_LEFT"
  | "TOP_CENTER"
  | "TOP_RIGHT"
  | "MIDDLE_LEFT"
  | "CENTER"
  | "MIDDLE_RIGHT"
  | "BOTTOM_LEFT"
  | "BOTTOM_CENTER"
  | "BOTTOM_RIGHT";

export type WatermarkLayout = "SINGLE" | "TILED";

export const WATERMARK_FONT_FAMILIES = [
  "Arial",
  "Helvetica",
  "Georgia",
  "Times New Roman",
  "Courier New",
] as const;

export type WatermarkFontFamily = (typeof WATERMARK_FONT_FAMILIES)[number];

export interface WatermarkConfigurationProps {
  type?: WatermarkType;
  text?: string | null;
  logoUrl?: string | null;
  logoScale?: number;
  position: WatermarkPosition;
  opacity: number;
  layout?: WatermarkLayout;
  rotation?: number;
  offsetX?: number;
  offsetY?: number;
  fontFamily?: WatermarkFontFamily;
  fontSize?: number;
  textColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
}

/**
 * Value Object: toàn bộ cấu hình cần để tái tạo chính xác một watermark.
 * Object này bất biến; mọi luật cấu hình được kiểm tra tại một chỗ.
 */
export class WatermarkConfiguration {
  readonly type: WatermarkType;
  readonly text: string | null;
  readonly logoUrl: string | null;
  readonly logoScale: number;
  readonly position: WatermarkPosition;
  readonly opacity: number;
  readonly layout: WatermarkLayout;
  readonly rotation: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly fontFamily: WatermarkFontFamily;
  readonly fontSize: number;
  readonly textColor: string;
  readonly strokeColor: string;
  readonly strokeWidth: number;

  constructor(props: WatermarkConfigurationProps) {
    this.type = props.type ?? "TEXT";
    this.position = props.position;
    this.opacity = numberInRange(props.opacity, 0, 1, "Opacity");
    this.layout = props.layout ?? "SINGLE";
    this.rotation = numberInRange(props.rotation ?? 0, -180, 180, "Góc xoay");
    this.offsetX = numberInRange(props.offsetX ?? 0, -0.5, 0.5, "Offset X");
    this.offsetY = numberInRange(props.offsetY ?? 0, -0.5, 0.5, "Offset Y");
    this.logoScale = numberInRange(props.logoScale ?? 0.2, 0.05, 1, "Kích thước logo");
    this.fontFamily = parseFontFamily(props.fontFamily ?? "Arial");
    this.fontSize = numberInRange(props.fontSize ?? 0.045, 0.01, 0.2, "Kích thước chữ");
    this.textColor = parseHexColor(props.textColor ?? "#FFFFFF", "Màu chữ");
    this.strokeColor = parseHexColor(props.strokeColor ?? "#000000", "Màu viền");
    this.strokeWidth = numberInRange(props.strokeWidth ?? 2, 0, 10, "Độ dày viền");

    if (this.type === "TEXT") {
      const text = props.text?.trim() ?? "";
      if (!text) throw new Error("Nội dung watermark không được để trống");
      if (text.length > 100)
        throw new Error("Nội dung watermark không được vượt quá 100 ký tự");
      this.text = text;
      this.logoUrl = null;
      return;
    }

    const logoUrl = props.logoUrl?.trim() ?? "";
    if (!logoUrl) throw new Error("Logo watermark không được để trống");
    if (!isSupportedLogoSource(logoUrl)) throw new Error("Nguồn logo không hợp lệ");
    this.text = null;
    this.logoUrl = logoUrl;
  }
}

function numberInRange(
  value: number,
  minimum: number,
  maximum: number,
  label: string
): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} phải nằm trong khoảng ${minimum} đến ${maximum}`);
  }
  return value;
}

function parseFontFamily(value: string): WatermarkFontFamily {
  if (!WATERMARK_FONT_FAMILIES.includes(value as WatermarkFontFamily)) {
    throw new Error("Font watermark không được hỗ trợ");
  }
  return value as WatermarkFontFamily;
}

function parseHexColor(value: string, label: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(normalized)) {
    throw new Error(`${label} phải có định dạng #RRGGBB`);
  }
  return normalized;
}

function isSupportedLogoSource(value: string): boolean {
  if (/^\/api\/media\/assets\/[a-zA-Z0-9_-]+\/content$/.test(value)) {
    return true;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}
