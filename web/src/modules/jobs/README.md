# Background jobs — BullMQ + Redis

Module này tách việc **nhận HTTP request** khỏi việc **xử lý ảnh nặng**.

## Luồng đầy đủ

```text
POST /api/watermarks/jobs
  │
  ├─ 1. CreateWatermarkJob lưu WatermarkJob(PENDING) vào MySQL
  │
  └─ 2. EnqueueJob tạo thông điệp WATERMARK_PROCESS
         │
         ▼
      BullMqJobQueue ──publish──> Redis
                                  │
                                  ▼
                           BullMqWorker
                                  │
                                  ▼
                         ProcessWatermarkJob
                                  │
                                  ▼
                   MySQL: PROCESSING → COMPLETED/FAILED
```

API trả response ngay sau khi publish thành công. Worker nhận job trực tiếp từ
Redis; không còn polling bảng `BackgroundJob` mỗi 2 giây.

## Vì sao vẫn cần cả Redis và MySQL?

Hai nơi có trách nhiệm khác nhau:

| Nơi lưu | Trách nhiệm |
| --- | --- |
| Redis/BullMQ | Job nào đang chờ, đang chạy, số lần thử, backoff, lock worker |
| MySQL/`WatermarkJob` | Trạng thái nghiệp vụ merchant nhìn thấy, cấu hình watermark, kết quả và lỗi cuối |

Redis là “người giao việc”; MySQL là “hồ sơ nghiệp vụ”. Không nên dùng Redis
làm nguồn dữ liệu duy nhất vì lịch sử watermark vẫn phải tồn tại khi queue dọn
các job cũ.

## Các file cần đọc theo thứ tự

1. `application/EnqueueJob.ts`: use case tạo `BackgroundJob` trung lập với công nghệ.
2. `application/JobQueue.ts`: port `JobPublisher` mà application phụ thuộc.
3. `infrastructure/BullMqJobQueue.ts`: adapter đưa job vào Redis.
4. `infrastructure/BullMqWorker.ts`: nhận job và gọi handler theo `job.name`.
5. `infrastructure/RedisConnection.ts`: đọc cấu hình Redis từ environment.
6. `web/index.ts`: composition root nối adapter với `ProcessWatermarkJob`.

`DatabaseJobQueue`, `RunPendingJobs` và `WatermarkWorker` được giữ lại để không
phá code cũ, nhưng runtime trong `web/index.ts` không còn dùng chúng.

## Retry hoạt động thế nào?

Mỗi job mặc định có 3 attempts (lần chạy đầu và tối đa 2 lần retry). Nếu handler
throw lỗi, BullMQ dùng exponential backoff: khoảng 1 giây rồi 2 giây trước hai
lần retry. Mỗi lần thử lại:

```text
MySQL FAILED → PENDING → PROCESSING → COMPLETED hoặc FAILED
```

Nếu worker chết khi job đang chạy, BullMQ phát hiện job bị stalled và giao lại.
Worker truyền `resumeProcessing: true`, nên `ProcessWatermarkJob` có thể tiếp tục
job đang `PROCESSING` thay vì để bản ghi MySQL mắc kẹt.

Đây là cơ chế **at-least-once**: trong sự cố hiếm, cùng một công việc có thể chạy
hơn một lần. Vì vậy handler phải hướng tới idempotent; trạng thái `COMPLETED` và
`CANCELLED` luôn được kiểm tra trước khi render.

## Concurrency

Mặc định một process xử lý tối đa 2 job cùng lúc. Có thể đổi bằng:

```env
BULLMQ_WORKER_CONCURRENCY=4
```

Tăng từ từ vì render ảnh dùng CPU và RAM. Có thể chạy nhiều instance app; Redis
sẽ phân phối mỗi job cho một worker đang giữ lock.

## Cấu hình local

Khởi động MySQL và Redis:

```shell
docker compose up -d mysql redis
```

Cấu hình mặc định đã khớp với `compose.yaml`:

```env
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
BULLMQ_QUEUE_NAME=watermark-processing
BULLMQ_WORKER_CONCURRENCY=2
```

Production thường chỉ cần một URL:

```env
REDIS_URL=rediss://username:password@host:6380/0
```

Các biến được hỗ trợ: `REDIS_URL`, hoặc bộ `REDIS_HOST`, `REDIS_PORT`,
`REDIS_USERNAME`, `REDIS_PASSWORD`, `REDIS_DB`; ngoài ra có
`BULLMQ_QUEUE_NAME`, `BULLMQ_PREFIX`, `BULLMQ_WORKER_CONCURRENCY`.

Redis trong `compose.yaml` bật AOF và `maxmemory-policy=noeviction`. Khi app nhận
`SIGINT`/`SIGTERM`, server ngừng nhận request mới, BullMQ chờ job hiện tại kết
thúc, rồi mới đóng kết nối Redis và Prisma.
