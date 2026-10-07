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

- `WatermarkConfiguration` là Value Object bất biến cho **một lớp**. Nó kiểm tra nội dung text/logo, opacity, font, màu sắc, rotation, offset, layout và vị trí.
- `WatermarkDesign` là Value Object gồm nhiều lớp có thứ tự (lớp đầu nằm dưới cùng). Nó áp giới hạn tối đa 10 lớp, 3 lớp logo và 3 lớp Tiled đang bật, và đọc được template cũ (cấu hình phẳng) thành design một lớp. Frontend import chính file này để kiểm tra cùng một luật.
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
- `PrismaWatermarkDesigns`: lưu design vào bảng `watermark_designs`. Design bất biến và dùng lại theo hash nội dung trong shop, nên batch 10.000 job chỉ có một dòng design.
- `SharpWatermarkProcessor`: ghép mọi lớp đang bật trong **một** lần `composite`, nên ảnh chỉ decode/encode một lần dù có 7 lớp.

### Presentation

`WatermarkController` chuyển HTTP body thành input của use case. Controller không tự chứa luật watermark.

## Luồng khi người dùng nhấn “Tạo ảnh watermark”

```text
WatermarkStudio.tsx
  → POST /api/watermarks/jobs
  → CreateWatermarkJob
  → WatermarkDesign kiểm tra từng lớp và giới hạn số lớp
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

Nếu UI, API và Sharp tự kiểm tra riêng, ba nơi rất dễ chấp nhận ba bộ giá trị khác nhau. Domain Value Object tạo một “cửa vào” duy nhất. Sau khi `WatermarkDesign` được tạo thành công, application và infrastructure có thể tin rằng dữ liệu hợp lệ.

## Khi thêm một thuộc tính mới

Ví dụ thêm `padding`:

1. Thêm thuộc tính và luật kiểm tra vào `WatermarkConfiguration`.
2. Thêm field vào `SerializedWatermarkLayer`, `WatermarkDesign.toJSON()` và `toLayerProps()`. Lớp được lưu dạng JSON nên **không cần migration**; design cũ thiếu field sẽ dùng giá trị mặc định.
3. Dùng thuộc tính trong `SharpWatermarkProcessor` và `WatermarkPreview`.
4. Thêm control vào form chỉnh lớp trong `UnifiedWatermarkStudio`.
5. Thêm test domain và processor.

Đi theo thứ tự này giúp luật nghiệp vụ dẫn dắt code, thay vì để giao diện hoặc database quyết định thiết kế domain.
