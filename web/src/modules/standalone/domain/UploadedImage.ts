export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_TITLE_LENGTH = 255;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Sản phẩm ở chế độ độc lập là một ảnh người dùng tải lên. Tiền tố giúp phân biệt
 * với ID sản phẩm Shopify (`gid://shopify/Product/...`) trong cùng cột.
 */
export const UPLOADED_PRODUCT_PREFIX = "upload-";

export type UploadedImageType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

/** Xác định định dạng theo magic bytes, không tin Content-Type do trình duyệt gửi. */
export function detectImageType(bytes: Buffer): UploadedImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return "image/png";
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString("latin1"))) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/** Tên hiển thị của ảnh: bỏ phần mở rộng, gọn khoảng trắng, giới hạn độ dài. */
export function imageTitle(raw: unknown): string {
  const title = (typeof raw === "string" ? raw : "")
    .replace(/\.[A-Za-z0-9]{2,5}$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TITLE_LENGTH);
  return title || "Ảnh chưa đặt tên";
}

export function imageProductType(raw: unknown): string {
  return (typeof raw === "string" ? raw : "").trim().slice(0, MAX_TITLE_LENGTH);
}
