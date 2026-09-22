export type WatermarkJobStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED";
export type WatermarkPosition =
  | "TOP_LEFT"
  | "TOP_RIGHT"
  | "CENTER"
  | "BOTTOM_LEFT"
  | "BOTTOM_RIGHT";

export type WatermarkType = "TEXT" | "IMAGE";

interface WatermarkJobProps {
  id: string;
  shopDomain: string;
  productId: string;
  sourceImageUrl: string;
  watermarkType?: WatermarkType;
  text?: string | null;
  logoUrl?: string | null;
  logoScale?: number;
  position: WatermarkPosition;
  opacity: number;
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
  readonly watermarkType: WatermarkType;
  readonly text: string | null;
  readonly logoUrl: string | null;
  readonly logoScale: number;
  readonly position: WatermarkPosition;
  readonly opacity: number;
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
    if (!isHttpUrl(props.sourceImageUrl))
      throw new Error("URL ảnh nguồn không hợp lệ");

    const type = props.watermarkType ?? "TEXT";
    let text: string | null = null;
    let logoUrl: string | null = null;

    if (type === "TEXT") {
      text = props.text?.trim() ?? "";
      if (!text) throw new Error("Nội dung watermark không được để trống khi chọn loại chữ");
      if (text.length > 100)
        throw new Error("Nội dung watermark không được vượt quá 100 ký tự");
    } else if (type === "IMAGE") {
      logoUrl = props.logoUrl?.trim() ?? "";
      if (!logoUrl) throw new Error("URL logo không được để trống khi chọn loại ảnh");
      if (!isHttpUrl(logoUrl) && !logoUrl.startsWith("/api/media/")) {
        throw new Error("URL logo không hợp lệ");
      }
    }

    const scale = Number.isFinite(props.logoScale) && props.logoScale! > 0 && props.logoScale! <= 1
      ? props.logoScale!
      : 0.2;

    if (
      !Number.isFinite(props.opacity) ||
      props.opacity < 0 ||
      props.opacity > 1
    )
      throw new Error("Opacity phải nằm trong khoảng từ 0 đến 1");

    this.id = props.id;
    this.shopDomain = props.shopDomain;
    this.productId = props.productId;
    this.sourceImageUrl = props.sourceImageUrl;
    this.watermarkType = type;
    this.text = text;
    this.logoUrl = logoUrl;
    this.logoScale = scale;
    this.position = props.position;
    this.opacity = props.opacity;
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
    if (this.currentStatus !== "PENDING" && this.currentStatus !== "FAILED")
      throw new Error("Job không thể bắt đầu ở trạng thái hiện tại");
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
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
