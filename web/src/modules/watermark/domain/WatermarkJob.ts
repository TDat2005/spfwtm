import {
  WatermarkConfiguration,
  type WatermarkConfigurationProps,
  type WatermarkFontFamily,
  type WatermarkLayout,
  type WatermarkPosition,
  type WatermarkType,
} from "./WatermarkConfiguration.ts";

export type WatermarkJobStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export { WatermarkConfiguration } from "./WatermarkConfiguration.ts";
export type {
  WatermarkConfigurationProps,
  WatermarkFontFamily,
  WatermarkLayout,
  WatermarkPosition,
  WatermarkType,
} from "./WatermarkConfiguration.ts";

export interface WatermarkJobProps {
  id: string;
  shopDomain: string;
  productId: string;
  sourceImageUrl: string;
  configuration: WatermarkConfiguration | WatermarkConfigurationProps;
  status?: WatermarkJobStatus;
  resultMediaId?: string | null;
  errorMessage?: string | null;
  createdAt?: Date;
}

/**
 * Aggregate Root: đại diện một lần xử lý watermark và bảo vệ vòng đời của job.
 */
export class WatermarkJob {
  readonly id: string;
  readonly shopDomain: string;
  readonly productId: string;
  readonly sourceImageUrl: string;
  readonly configuration: WatermarkConfiguration;
  readonly createdAt: Date;
  private currentStatus: WatermarkJobStatus;
  private currentResultMediaId: string | null;
  private currentErrorMessage: string | null;

  constructor(props: WatermarkJobProps) {
    if (!props.id.trim())
      throw new Error("Watermark job ID không được để trống");
    if (!props.shopDomain.trim())
      throw new Error("Shop domain không được để trống");
    if (!props.productId.trim())
      throw new Error("Product ID không được để trống");
    if (!isHttpsUrl(props.sourceImageUrl))
      throw new Error("URL ảnh nguồn phải sử dụng HTTPS");

    this.id = props.id;
    this.shopDomain = props.shopDomain;
    this.productId = props.productId;
    this.sourceImageUrl = props.sourceImageUrl;
    this.configuration =
      props.configuration instanceof WatermarkConfiguration
        ? props.configuration
        : new WatermarkConfiguration(props.configuration);
    this.currentStatus = props.status ?? "PENDING";
    this.currentResultMediaId = props.resultMediaId ?? null;
    this.currentErrorMessage = props.errorMessage ?? null;
    this.createdAt = props.createdAt ?? new Date();
  }

  get status(): WatermarkJobStatus {
    return this.currentStatus;
  }
  get resultMediaId(): string | null {
    return this.currentResultMediaId;
  }
  get errorMessage(): string | null {
    return this.currentErrorMessage;
  }

  get watermarkType(): WatermarkType {
    return this.configuration.type;
  }
  get text(): string | null {
    return this.configuration.text;
  }
  get logoUrl(): string | null {
    return this.configuration.logoUrl;
  }
  get logoScale(): number {
    return this.configuration.logoScale;
  }
  get position(): WatermarkPosition {
    return this.configuration.position;
  }
  get opacity(): number {
    return this.configuration.opacity;
  }
  get layout(): WatermarkLayout {
    return this.configuration.layout;
  }
  get rotation(): number {
    return this.configuration.rotation;
  }
  get offsetX(): number {
    return this.configuration.offsetX;
  }
  get offsetY(): number {
    return this.configuration.offsetY;
  }
  get fontFamily(): WatermarkFontFamily {
    return this.configuration.fontFamily;
  }
  get fontSize(): number {
    return this.configuration.fontSize;
  }
  get textColor(): string {
    return this.configuration.textColor;
  }
  get strokeColor(): string {
    return this.configuration.strokeColor;
  }
  get strokeWidth(): number {
    return this.configuration.strokeWidth;
  }

  start(): void {
    if (this.currentStatus !== "PENDING")
      throw new Error("Chỉ job đang chờ mới có thể bắt đầu");
    this.currentStatus = "PROCESSING";
    this.currentErrorMessage = null;
  }

  complete(resultMediaId: string): void {
    if (this.currentStatus !== "PROCESSING")
      throw new Error("Chỉ job đang xử lý mới có thể hoàn thành");
    if (!resultMediaId.trim())
      throw new Error("Result media ID không được để trống");
    this.currentStatus = "COMPLETED";
    this.currentResultMediaId = resultMediaId;
    this.currentErrorMessage = null;
  }

  fail(message: string): void {
    if (this.currentStatus !== "PROCESSING")
      throw new Error("Chỉ job đang xử lý mới có thể thất bại");
    if (!message.trim()) throw new Error("Lý do thất bại không được để trống");
    this.currentStatus = "FAILED";
    this.currentErrorMessage = message.trim();
  }

  retry(): void {
    if (this.currentStatus !== "FAILED")
      throw new Error("Chỉ job thất bại mới có thể thử lại");
    this.currentStatus = "PENDING";
    this.currentErrorMessage = null;
  }

  cancel(): void {
    if (this.currentStatus !== "PENDING")
      throw new Error("Chỉ job đang chờ mới có thể hủy");
    this.currentStatus = "CANCELLED";
    this.currentErrorMessage = null;
  }
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
