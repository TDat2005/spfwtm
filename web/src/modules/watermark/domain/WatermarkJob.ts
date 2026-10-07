import { WatermarkDesign, type WatermarkLayerProps } from "./WatermarkDesign.ts";

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
export { WatermarkDesign } from "./WatermarkDesign.ts";
export type { WatermarkLayerProps } from "./WatermarkDesign.ts";

export interface WatermarkJobProps {
  id: string;
  shopDomain: string;
  productId: string;
  sourceImageUrl: string;
  design: WatermarkDesign | ReadonlyArray<WatermarkLayerProps>;
  /** Xong thì tự đưa lên Shopify (job do rule có autoPublish tạo). */
  publishOnComplete?: boolean;
  status?: WatermarkJobStatus;
  resultMediaId?: string | null;
  errorMessage?: string | null;
  createdAt?: Date;
}

export class WatermarkJob {
  readonly id: string;
  readonly shopDomain: string;
  readonly productId: string;
  readonly sourceImageUrl: string;
  readonly design: WatermarkDesign;
  readonly publishOnComplete: boolean;
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
    this.design =
      props.design instanceof WatermarkDesign
        ? props.design
        : new WatermarkDesign(props.design);
    this.publishOnComplete = props.publishOnComplete ?? false;
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
