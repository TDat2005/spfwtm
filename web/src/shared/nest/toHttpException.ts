import { HttpException, HttpStatus, Logger } from "@nestjs/common";

/**
 * Đổi lỗi từ use case thành HttpException để Nest tự trả response.
 * Body giữ dạng { error: string } như frontend đang dùng.
 */
export function toHttpException(
  label: string,
  error: unknown,
  status: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR,
  publicMessage?: string,
): HttpException {
  if (error instanceof HttpException) return error;
  const message = error instanceof Error ? error.message : "Lỗi không xác định";
  new Logger(label).error(message);
  return new HttpException({ error: publicMessage ?? message }, status);
}
