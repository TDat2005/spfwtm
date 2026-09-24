# Product media sync

Module này nhận webhook thay đổi sản phẩm và chỉ theo dõi **ảnh chính** trong
giai đoạn MVP.

## Luồng xử lý

1. Shopify SDK xác thực HMAC trước khi callback được gọi.
2. `ReceiveProductWebhook` ghi delivery vào `WebhookInbox`. `webhookId` là khóa
   idempotency, nên webhook gửi lặp không tạo thêm job.
3. `PRODUCT_MEDIA_RECONCILE_V1` được đưa vào BullMQ với debounce 4 giây. HTTP
   webhook không tải, render hoặc upload ảnh.
4. Worker lấy trạng thái product/media mới nhất bằng GraphQL Admin API 2026-07.
   Payload webhook chỉ dùng để định danh product và lưu audit.
5. `MediaChangeClassifier` so sánh ảnh chính với `sourceMediaId`,
   `PublishedMedia` và `PublicationAttempt`.
6. Ở manual mode, ảnh mới của merchant tăng `sourceVersion` và đặt
   `needsReview=true`; module không tự publish lại sản phẩm.

## Chống vòng lặp

Luồng publish tạo `PublicationAttempt=PUBLISHING` trước khi upload. Ngay khi
Shopify trả MediaImage ID, ID được lưu vào attempt và `PublishedMedia` trước khi
reorder. Nếu webhook đến trong cửa sổ này, reconcile nhận ra media của app hoặc
trì hoãn ngắn để tránh tạo vòng lặp.

## Quy tắc MVP

- Sửa title/tag hoặc ảnh chính không đổi: bỏ qua.
- Ảnh chính thuộc `PublishedMedia`: bỏ qua.
- Publication đang chạy: retry reconcile, không tạo công việc watermark mới.
- Merchant upload ảnh chính mới: cập nhật snapshot nguồn và báo review.
- Chỉ reorder ảnh cũ: bỏ qua render.
- Không còn ảnh hoặc product bị xóa: hủy watermark đang chờ và báo review.
- Mọi lookup đều có `shopId`/shop domain để product ID giống nhau giữa hai shop
  không thể chạm dữ liệu của nhau.
