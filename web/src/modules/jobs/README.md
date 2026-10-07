# Jobs module: BullMQ lanes

BullMQ lo giao việc, retry và concurrency. MySQL vẫn giữ trạng thái nghiệp vụ
(`WatermarkJob`, `WebhookInbox`...).

## Ba lane

| Lane | Queue | Job |
|---|---|---|
| `interactive` | `<BULLMQ_QUEUE_NAME>-interactive` | Job watermark lẻ, retry, batch ≤ 50 sản phẩm, auto-rule cho 1 sản phẩm |
| `bulk` | `<BULLMQ_QUEUE_NAME>-bulk` | Batch lớn, được `DispatchWatermarkBatch` nhỏ giọt |
| `system` | `<BULLMQ_QUEUE_NAME>` | Reconcile webhook, catalog sync, publish, job định kỳ |

Lane `system` giữ tên queue cũ để những job đã nằm trong Redis trước khi tách
lane vẫn được xử lý (worker của lane nào cũng biết mọi handler).

Lane và priority mặc định nằm trong `domain/JobDefinitions.ts`; nơi gọi có thể
ghi đè (`{ ...WATERMARK_PROCESS_V1, lane: "bulk", priority: ... }`). Trong BullMQ
job **không có** priority lại chạy trước mọi job có priority, nên `BackgroundJob`
bắt buộc priority từ 1 trở lên.

## Batch lớn không chặn người khác

`DispatchWatermarkBatch` chỉ giữ tối đa `BULK_WINDOW_SIZE` (25) job của một batch
trong lane bulk. Mỗi job xong (hoặc thất bại ở lần thử cuối) lại gọi dispatcher
để bù chỗ trống, nên batch của nhiều shop chạy xen kẽ nhau. `enqueuedAt` trên
`WatermarkJob` đánh dấu job đã vào queue; job `PENDING` vào queue quá 30 phút được
coi là có thể đã mất. Job định kỳ `WATERMARK_BATCH_DISPATCH_V1` (mỗi 60 giây)
bù cho batch bị kẹt. BullMQ jobId `wm_<id>` chống đưa trùng.

## Chạy

```bash
npm run dev           # web + worker trong một tiến trình (tiện cho dev)
npm run dev:worker    # chỉ worker

# production
WORKER_ENABLED=false npm run serve      # web không xử lý job
npm run worker                          # một hoặc nhiều tiến trình worker
WORKER_LANES=bulk npm run worker        # tăng riêng worker cho batch lớn
```

## Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `BULLMQ_QUEUE_NAME` | `watermark-processing` | Tên gốc của các queue |
| `BULLMQ_WORKER_CONCURRENCY` | `2` | Concurrency mặc định cho mọi lane |
| `BULLMQ_INTERACTIVE_CONCURRENCY` / `BULLMQ_BULK_CONCURRENCY` / `BULLMQ_SYSTEM_CONCURRENCY` | theo biến trên | Concurrency từng lane |
| `WORKER_ENABLED` | `true` | Tiến trình này có chạy worker không (`worker.ts` luôn bật) |
| `WORKER_LANES` | cả ba | Danh sách lane, cách nhau bởi dấu phẩy |
| `SHARP_CONCURRENCY` | số nhân CPU | Số thread libvips cho mỗi ảnh; nên ≈ số nhân CPU / tổng concurrency |
