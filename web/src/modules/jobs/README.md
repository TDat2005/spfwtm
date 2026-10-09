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

`DispatchWatermarkBatch` giới hạn số job nằm trong queue **theo shop**, dù shop
tạo bao nhiêu batch:

| Loại batch | Lane | Cửa sổ mỗi shop |
|---|---|---|
| ≤ 50 sản phẩm | `interactive` | `INTERACTIVE_SHOP_WINDOW` = 50 |
| > 50 sản phẩm | `bulk` | `BULK_SHOP_WINDOW` = 25 |

Batch tạo trước của cùng shop chạy trước. Mỗi job xong (hoặc thất bại ở lần thử
cuối) lại gọi dispatcher để bù chỗ, nên batch của nhiều shop chạy xen kẽ nhau.
Ví dụ: shop A đang chạy 10.000 sản phẩm, shop B tạo batch 100 sản phẩm thì B chỉ
đứng sau 25 job của A đang nằm trong queue, sau đó hai shop chạy xen kẽ. Batch
≤ 50 sản phẩm của B đi lane interactive nên không phải chờ A.

`enqueuedAt` trên `WatermarkJob` đánh dấu job đã vào queue (job lẻ cũng ghi, qua
`EnqueueWatermarkJob`). Mỗi job watermark có id `wm_<id>` trong BullMQ nên không
bị đưa trùng.

## jobId cố định và `replaceFinished`

BullMQ bỏ qua job mới trùng jobId với bản ghi cũ còn giữ (hoàn thành: 1 giờ,
thất bại: 7 ngày). Job có jobId cố định mà cần chạy lại (retry, publish lại,
reconcile webhook của cùng sản phẩm) phải đưa vào với `replaceFinished: true`:
`BullMqJobQueue` xóa bản ghi đã xong/thất bại trước rồi mới thêm. Job còn đang
chờ hoặc đang chạy thì không bị xóa, nên vẫn không tạo bản trùng.

## Khi worker chết

| Tình huống | Xử lý |
|---|---|
| Handler ném lỗi | BullMQ retry 3 lần. Giữa các lần thử job vẫn `PROCESSING` (vẫn giữ chỗ), lần cuối mới `FAILED`. |
| Tiến trình chết (OOM, kill -9) | Lock 30 giây hết hạn, BullMQ đưa job về hàng chờ, `ProcessWatermarkJob` chạy tiếp từ `PROCESSING`. |
| Chết 2 lần trên cùng job (ảnh "độc") | BullMQ đánh job thất bại mà **không gọi handler**. `RecoverWatermarkJobs` thấy job `PROCESSING` quá 5 phút mà queue không còn job thì đánh `FAILED` và nhả chỗ. |
| Tiến trình "sống nhưng đơ" (thao tác native bị kẹt, event loop vẫn chạy nên lock vẫn được gia hạn) | Canh giờ trong `BullMqWorker`: job chạy quá giới hạn (watermark 5 phút, mặc định 10 phút) thì ghi log và **thoát tiến trình**, lock hết hạn, worker khác nhận lại. Job quét cả shop (`AUTO_WATERMARK_APPLY_V1`, `CATALOG_RECONCILE_V1`) không bị canh. Ở production cần trình quản lý tiến trình tự bật lại worker; khi dev, chạy lại `npm run dev`. |
| Webhook sản phẩm bị kẹt hoặc job reconcile thất bại hết lượt | `MEDIA_SYNC_RECOVER_V1` (mỗi 5 phút) đưa lại sản phẩm có webhook chưa xong quá 10 phút mà không còn job nào trong queue, và đánh `FAILED` lượt publish đứng `PUBLISHING` quá 30 phút. |
| Job vào queue rồi bị mất (Redis mất dữ liệu...) | `RecoverWatermarkJobs` thấy job `PENDING` đã vào queue quá 5 phút mà queue không còn job thì đưa lại. |
| SIGTERM | `worker.close()` chờ job đang chạy xong. |

Job định kỳ `WATERMARK_BATCH_DISPATCH_V1` (mỗi 60 giây) chạy `RecoverWatermarkJobs`
rồi `sweep()` để bù chỗ cho batch bị kẹt.

Ảnh trên 50 megapixel bị từ chối trước khi decode (`MAX_INPUT_PIXELS`), vì một ảnh
khổng lồ làm worker hết RAM sẽ kéo chết mọi job đang chạy cùng tiến trình. Ở
production nên chạy lane `bulk` ở tiến trình riêng để sự cố của batch lớn không
ảnh hưởng tới lane `interactive`.

## Chạy

```bash
npm run dev           # web + worker trong một tiến trình (tiện cho dev)
npm run dev:worker    # chỉ worker

# production
WORKER_ENABLED=false npm run serve                  # web không xử lý job
WORKER_LANES=interactive,system npm run worker      # việc merchant đang chờ
WORKER_LANES=bulk npm run worker                    # batch lớn, tách riêng tiến trình
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
