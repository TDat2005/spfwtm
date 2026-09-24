# Shopify API versioning

Phiên bản đang được khóa cho GraphQL Admin API và webhook là **2026-07**.
Không dùng `LATEST_API_VERSION` và không nạp REST resources. Worker cũ được giữ
bằng job name có hậu tố version, ví dụ `WATERMARK_PROCESS_V1`.

## Nguyên tắc tương thích job

- Mỗi message có `jobName`, `payloadVersion` và `processorVersion`.
- Không đổi ý nghĩa hay payload của handler V1 khi queue vẫn có job V1.
- Thuật toán hoặc payload mới phải tạo `*_V2` và handler riêng.
- Chỉ xóa V1 sau khi xác nhận queue V1 đã hết, dead-letter đã xử lý và thời gian
  rollback của bản deploy cũ đã kết thúc.
- `WatermarkJob` lưu toàn bộ cấu hình watermark; worker luôn dùng snapshot này,
  không đọc preset mới nhất lúc chạy.

## Quy trình nâng version theo quý

1. Chọn một Shopify API stable còn trong thời gian hỗ trợ; không dùng release
   candidate cho production.
2. Đổi cùng lúc `shopify.app.toml` và `SHOPIFY_API_VERSION` trong backend.
3. Chạy `npm run check:api-version` để phát hiện version lệch, version cũ,
   `LATEST_API_VERSION` hoặc REST resources.
4. Chạy validator GraphQL cho mọi operation với version mục tiêu và chạy fixture
   webhook mang đúng `apiVersion`.
5. Chạy `npm run ci`, sau đó thử trên development store: title-only update,
   upload ảnh merchant, app publish, reorder, delete và webhook trùng.
6. Deploy canary, quan sát `WebhookInbox.FAILED`, BullMQ failed jobs và API
   deprecation headers trước khi rollout đầy đủ.
7. Giữ handler job version cũ qua ít nhất một chu kỳ deploy/rollback.

Nếu API version mới làm thay đổi schema webhook hoặc GraphQL, cập nhật fixture và
tạo migration/processor version mới trước khi đổi version production.
