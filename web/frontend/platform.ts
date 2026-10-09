0  /**
 * Server đánh dấu trang chạy ở chế độ độc lập bằng
 * `<meta name="app-platform" content="standalone">` (xem SpaController);
 * không có thẻ này nghĩa là đang nhúng trong Shopify Admin.
 */
export type Platform = "shopify" | "standalone";

export const PLATFORM: Platform =
  document.querySelector('meta[name="app-platform"]')?.getAttribute("content") === "standalone"
    ? "standalone"
    : "shopify";

export const isShopify = PLATFORM === "shopify";

/** fetchJson phát sự kiện này khi session độc lập hết hạn để hiện lại màn đăng nhập. */
export const UNAUTHORIZED_EVENT = "standalone:unauthorized";
