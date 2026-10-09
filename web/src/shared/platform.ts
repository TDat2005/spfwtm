import type { Request } from "express";

/**
 * App chạy được hai chế độ trên cùng một server:
 * - "shopify": nhúng trong Shopify Admin, xác thực bằng session token của App Bridge.
 * - "standalone": mở trực tiếp trên trình duyệt, xác thực bằng tài khoản email/mật khẩu.
 */
export type AppPlatform = "shopify" | "standalone";

/** Tắt chế độ độc lập bằng STANDALONE_ENABLED=false (mặc định bật). */
export function standaloneEnabled(): boolean {
  return process.env.STANDALONE_ENABLED !== "false";
}

/**
 * Shopify luôn mở app kèm `?shop=`; trước đây request không có `shop` bị trả 400,
 * nên dùng đúng nhánh đó cho chế độ độc lập mà không ảnh hưởng luồng Shopify.
 */
export function isStandalonePageRequest(request: Request): boolean {
  return standaloneEnabled() && typeof request.query.shop !== "string";
}

/**
 * Domain của Shop ứng với một tài khoản độc lập. Shopify chỉ cấp session cho
 * `*.myshopify.com` nên không thể trùng với shop thật.
 */
export function standaloneShopDomain(accountId: string): string {
  return `${accountId.toLowerCase()}.standalone.local`;
}
