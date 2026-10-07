# Auto-watermark rules

Rule tự đóng watermark cho sản phẩm thuộc một phạm vi: **cả shop**, **một
collection** hoặc **một loại sản phẩm**, bằng một `WatermarkDesign` nhiều lớp.

## Ai sở hữu sản phẩm?

Mỗi sản phẩm thuộc về đúng **một** rule: rule đang bật, ưu tiên cao nhất
(`priority` lớn hơn thắng, bằng nhau thì rule tạo trước thắng) và có phạm vi khớp.
Trigger chỉ quyết định *khi nào* rule sở hữu hành động. Rule thấp hơn không bao
giờ đóng dấu thay, kể cả khi rule sở hữu không bật trigger đó. Nhờ vậy hai rule
không thay phiên đè lên cùng một sản phẩm.

| Trigger | Nguồn | Cần cờ |
|---|---|---|
| `NEW_PRODUCT` | webhook: sản phẩm có ảnh chính lần đầu | `onNewProduct` |
| `PRIMARY_CHANGED` | webhook: merchant đổi ảnh chính | `onPrimaryChanged` |
| `SYNC` | job hằng đêm `AUTO_WATERMARK_SYNC_V1` | `syncScope` |
| `MANUAL` | merchant bấm "Áp dụng ngay" | (rule đang bật) |

## Vì sao cần đồng bộ hằng đêm?

Shopify Admin API 2026-07 **không có webhook** báo sản phẩm được thêm vào hay rời
khỏi collection (`collections/*` chỉ báo khi metadata của collection đổi; smart
collection còn cập nhật thành viên bất đồng bộ). Vì vậy:

- Webhook sản phẩm hỏi Shopify `product.inCollection(id:)` cho rule collection,
  chỉ tới rule đầu tiên khớp.
- Đồng bộ (đêm hoặc bấm tay) liệt kê `collection.products` (250/trang) để bắt
  kịp sản phẩm vào/ra collection.

## Không render lặp lại

`CatalogProduct.autoRuleId/autoDesignId/autoSourceVersion` ghi job auto gần nhất.
Trùng cả ba thì bỏ qua (`ALREADY_APPLIED`), nên webhook lặp lại và đồng bộ đêm
không tạo job thừa. Đổi design của rule hoặc merchant đổi ảnh (tăng
`sourceVersion`) thì áp lại. Trạng thái được ghi lúc *tạo* job: job thất bại không
tự thử lại vô hạn, merchant thử lại từ lịch sử.

Khi áp hàng loạt (`SYNC`/`MANUAL`), sản phẩm đang có ảnh watermark merchant tự
làm (published media của job không có `ruleId`) được giữ nguyên.

## Luồng

```text
products/update webhook
  → ReconcileProductMedia (product-media-sync)
  → AUTO_WATERMARK_EVALUATE_V1 (lane system, retry riêng)
  → EvaluateProductRules → 1 WatermarkJob (lane interactive)

AUTO_WATERMARK_SYNC_V1 (03:30 mỗi đêm) / "Áp dụng ngay"
  → AUTO_WATERMARK_APPLY_V1 theo shop
  → ApplyAutoWatermarkRules → 1 WatermarkBatch mỗi rule → DispatchWatermarkBatch

WatermarkJob xong + publishOnComplete (rule bật autoPublish)
  → PUBLICATION_PUBLISH_V1 { replacePrevious, onlyIfLatest }
  → đặt ảnh mới làm ảnh chính, xóa ảnh watermark cũ của app trên sản phẩm
```

Ảnh do app publish quay về webhook dưới dạng `APP_MEDIA_PUBLISHED` và bị bỏ qua,
nên tự publish không tạo vòng lặp.

## Biến môi trường

| Biến | Mặc định |
|---|---|
| `AUTO_WATERMARK_SYNC_CRON` | `30 3 * * *` |
| `AUTO_WATERMARK_SYNC_TIMEZONE` | `Asia/Ho_Chi_Minh` |
