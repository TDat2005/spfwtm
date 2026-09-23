# Watermark module — DDD walkthrough

Module này chịu trách nhiệm **tạo ảnh watermark**. Nó không trực tiếp publish ảnh lên Shopify; việc đó thuộc module `shopify-publication`.

## Bốn lớp

```text
presentation/   HTTP request/response
      ↓
application/    các use case của người dùng
      ↓
domain/         luật nghiệp vụ và vòng đời job
      ↑
infrastructure/ Prisma, Sharp và các adapter kỹ thuật
```

### Domain

- `WatermarkConfiguration` là Value Object bất biến. Nó kiểm tra nội dung text/logo, opacity, font, màu sắc, rotation, offset, layout và vị trí.
- `WatermarkJob` là Aggregate Root. Mọi thay đổi trạng thái phải đi qua `start`, `complete`, `fail`, `retry` hoặc `cancel`.

Luồng trạng thái:

```text
PENDING ──start──> PROCESSING ──complete──> COMPLETED
                         └──────fail──────> FAILED ──retry──> PENDING
PENDING ──cancel──> CANCELLED
```

### Application

- `CreateWatermarkJob`: lấy ảnh sản phẩm và tạo aggregate.
- `ProcessWatermarkJob`: tải source/logo, gọi processor, lưu ảnh kết quả.
- `GetWatermarkJob` và `ListWatermarkJobs`: đọc job trong đúng shop.
- `RetryWatermarkJob` và `CancelWatermarkJob`: yêu cầu aggregate thực hiện transition rồi lưu lại.
- `WatermarkPorts`: interface mà application cần; lớp application không biết Prisma hay Sharp hoạt động thế nào.

### Infrastructure

- `PrismaWatermarkJobRepository`: chuyển đổi giữa row database và aggregate.
- `PrismaProductImageReader`: đọc URL ảnh sản phẩm qua một port nhỏ.
- `SharpWatermarkProcessor`: render text/logo theo cùng `WatermarkConfiguration` đã được domain xác thực.

### Presentation

`watermarkRoutes` chuyển HTTP body thành input của use case. Route không tự chứa luật watermark.

## Luồng khi người dùng nhấn “Tạo ảnh watermark”

```text
WatermarkStudio.tsx
  → POST /api/watermarks/jobs
  → CreateWatermarkJob
  → WatermarkConfiguration kiểm tra cấu hình
  → WatermarkJob được lưu bằng repository
  → BullMqJobQueue publish WATERMARK_PROCESS vào Redis
  → BullMqWorker nhận job và gọi ProcessWatermarkJob
  → MediaService đọc source/logo
  → SharpWatermarkProcessor render ảnh WebP
  → MediaService lưu kết quả
  → WatermarkJob chuyển thành COMPLETED
  → frontend polling và hiển thị preview
```

BullMQ chịu trách nhiệm giao việc, retry và concurrency. MySQL vẫn lưu trạng
thái nghiệp vụ của `WatermarkJob`; xem chi tiết tại
[`../jobs/README.md`](../jobs/README.md).

## Vì sao cấu hình nằm trong domain?

Nếu UI, API và Sharp tự kiểm tra riêng, ba nơi rất dễ chấp nhận ba bộ giá trị khác nhau. Domain Value Object tạo một “cửa vào” duy nhất. Sau khi `WatermarkConfiguration` được tạo thành công, application và infrastructure có thể tin rằng dữ liệu hợp lệ.

## Khi thêm một thuộc tính mới

Ví dụ thêm `padding`:

1. Thêm thuộc tính và luật kiểm tra vào `WatermarkConfiguration`.
2. Thêm cột Prisma và migration.
3. Map thuộc tính trong `PrismaWatermarkJobRepository`.
4. Dùng thuộc tính trong `SharpWatermarkProcessor`.
5. Nhận/trả thuộc tính trong `watermarkRoutes`.
6. Thêm control vào `WatermarkStudio`.
7. Thêm test domain và processor.

Đi theo thứ tự này giúp luật nghiệp vụ dẫn dắt code, thay vì để giao diện hoặc database quyết định thiết kế domain.
