export type BackgroundJobStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED";

export interface BackgroundJobProps {
  id: string;
  jobType: string;
  payload: Record<string, unknown>;
  status?: BackgroundJobStatus;
  attempts?: number;
  maxAttempts?: number;
  lastError?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export class BackgroundJob {
  readonly id: string;
  readonly jobType: string;
  readonly payload: Record<string, unknown>;
  readonly maxAttempts: number;
  readonly createdAt: Date;
  private currentStatus: BackgroundJobStatus;
  private currentAttempts: number;
  private currentLastError: string | null;
  private currentUpdatedAt: Date;

  constructor(props: BackgroundJobProps) {
    if (!props.id.trim()) throw new Error("Job ID không được để trống");
    if (!props.jobType.trim()) throw new Error("Job type không được để trống");

    this.id = props.id;
    this.jobType = props.jobType;
    this.payload = props.payload;
    this.currentStatus = props.status ?? "PENDING";
    this.currentAttempts = props.attempts ?? 0;
    this.maxAttempts = props.maxAttempts ?? 3;
    this.currentLastError = props.lastError ?? null;
    this.createdAt = props.createdAt ?? new Date();
    this.currentUpdatedAt = props.updatedAt ?? new Date();
  }

  get status(): BackgroundJobStatus {
    return this.currentStatus;
  }
  get attempts(): number {
    return this.currentAttempts;
  }
  get lastError(): string | null {
    return this.currentLastError;
  }
  get updatedAt(): Date {
    return this.currentUpdatedAt;
  }

  start(): void {
    if (this.currentStatus !== "PENDING" && this.currentStatus !== "FAILED") {
      throw new Error("Job không thể bắt đầu ở trạng thái hiện tại");
    }
    this.currentStatus = "PROCESSING";
    this.currentAttempts += 1;
    this.currentLastError = null;
    this.currentUpdatedAt = new Date();
  }

  complete(): void {
    if (this.currentStatus !== "PROCESSING") {
      throw new Error("Chỉ job đang xử lý mới có thể hoàn thành");
    }
    this.currentStatus = "COMPLETED";
    this.currentLastError = null;
    this.currentUpdatedAt = new Date();
  }

  fail(errorMessage: string): void {
    if (this.currentStatus !== "PROCESSING") {
      throw new Error("Chỉ job đang xử lý mới có thể đánh dấu thất bại");
    }
    this.currentStatus = "FAILED";
    this.currentLastError = errorMessage.trim();
    this.currentUpdatedAt = new Date();
  }

  canRetry(): boolean {
    return this.currentAttempts < this.maxAttempts;
  }

  retry(): void {
    if (this.currentStatus !== "FAILED") {
      throw new Error("Chỉ job thất bại mới có thể đưa về hàng đợi");
    }
    this.currentStatus = "PENDING";
    this.currentUpdatedAt = new Date();
  }
}
