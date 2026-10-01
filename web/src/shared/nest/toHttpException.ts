import { HttpException, HttpStatus, Logger } from "@nestjs/common";

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
