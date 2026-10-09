/**
 * Theo dõi queue watermark theo thời gian thực (làm mới mỗi 2 giây, Ctrl+C để thoát).
 *
 *   npm run watch:queue
 *   npm run watch:queue -- --hours 6     # xét job tạo trong 6 giờ gần nhất (mặc định 24)
 *
 * - Theo shop: trong_queue + dang_chay của batch lớn không được vượt BULK_SHOP_WINDOW (25).
 * - "treo": job PROCESSING không đổi gì quá 2 phút.
 * - Batch đang chạy: batch cũ của cùng shop phải xong trước batch mới.
 * - BullMQ: số job thật trong từng lane. "dinh_ky" là lần chạy kế của các job
 *   định kỳ (lane system luôn có), không phải job lỗi; "that_bai" giữ job lỗi cũ
 *   (job định kỳ: 30 ngày, job thường: 7 ngày) nên không tự về 0 ngay.
 */
import { parseArgs } from "node:util";
import { Queue } from "bullmq";
import { JOB_LANES } from "../src/modules/jobs/domain/JobDefinitions.ts";
import { redisRuntimeConfigFromEnv } from "../src/modules/jobs/infrastructure/RedisConnection.ts";
import { createPrismaClient } from "../src/shared/infrastructure/prisma.ts";
import { positiveInteger } from "./sampleImages.ts";

const REFRESH_MS = 2_000;

const { values: args } = parseArgs({ options: { hours: { type: "string", default: "24" } } });
const hours = positiveInteger(args.hours, "--hours");

const prisma = createPrismaClient();
const redis = redisRuntimeConfigFromEnv();
const queues = JOB_LANES.map((lane) => ({
  lane,
  queue: new Queue(redis.lanes[lane].queueName, {
    connection: redis.producerConnection,
    prefix: redis.prefix,
  }),
}));

type Row = Record<string, string | number | bigint | Date | null>;

async function render(): Promise<void> {
  const [shops, batches, lanes] = await Promise.all([
    prisma.$queryRawUnsafe<Row[]>(`
      SELECT s.domain AS shop,
        SUM(j.status = 'PROCESSING') AS dang_chay,
        SUM(j.status = 'PENDING' AND j.enqueuedAt IS NOT NULL) AS trong_queue,
        SUM(j.status = 'PENDING' AND j.enqueuedAt IS NULL) AS cho_luot,
        SUM(j.status = 'COMPLETED') AS xong,
        SUM(j.status = 'FAILED') AS loi,
        SUM(j.status = 'PROCESSING' AND j.updatedAt < NOW(3) - INTERVAL 2 MINUTE) AS treo,
        SUM(j.status = 'COMPLETED' AND j.updatedAt > NOW(3) - INTERVAL 1 MINUTE) AS xong_1_phut
      FROM watermark_jobs j JOIN shops s ON s.id = j.shopId
      WHERE j.createdAt > NOW(3) - INTERVAL ? HOUR
      GROUP BY s.domain ORDER BY s.domain`, hours),
    prisma.$queryRawUnsafe<Row[]>(`
      SELECT s.domain AS shop, LEFT(b.id, 8) AS batch, b.totalJobs AS tong,
        b.createdAt AS tao_luc,
        SUM(j.status = 'COMPLETED') AS xong, SUM(j.status = 'FAILED') AS loi,
        SUM(j.status = 'PROCESSING' OR (j.status = 'PENDING' AND j.enqueuedAt IS NOT NULL)) AS dang_xu_ly,
        SUM(j.status = 'PENDING' AND j.enqueuedAt IS NULL) AS cho_luot
      FROM watermark_batches b
      JOIN shops s ON s.id = b.shopId
      JOIN watermark_jobs j ON j.batchId = b.id
      WHERE b.createdAt > NOW(3) - INTERVAL ? HOUR
      GROUP BY b.id
      HAVING SUM(j.status IN ('PENDING', 'PROCESSING')) > 0
      ORDER BY s.domain, b.createdAt`, hours),
    Promise.all(
      queues.map(async ({ lane, queue }) => {
        const [counts, schedulers] = await Promise.all([
          queue.getJobCounts("wait", "prioritized", "active", "delayed", "failed"),
          queue.getJobSchedulersCount(),
        ]);
        const delayed = counts.delayed ?? 0;
        // Mỗi lịch định kỳ luôn có một job hẹn giờ cho lần chạy kế: không phải job chờ thử lại.
        const scheduled = Math.min(schedulers, delayed);
        return {
          lane,
          cho: (counts.wait ?? 0) + (counts.prioritized ?? 0),
          dang_chay: counts.active ?? 0,
          cho_retry: delayed - scheduled,
          dinh_ky: scheduled,
          that_bai: counts.failed ?? 0,
        };
      }),
    ),
  ]);

  console.clear();
  console.log(`Queue watermark — ${new Date().toLocaleTimeString("vi-VN")} (job tạo trong ${hours} giờ, Ctrl+C để thoát)\n`);
  console.log("Theo shop");
  printTable(shops);
  console.log("\nBatch đang chạy");
  printTable(batches);
  console.log("\nBullMQ");
  printTable(lanes);
}

function printTable(rows: Array<Record<string, unknown>>): void {
  if (rows.length === 0) {
    console.log("  (trống)");
    return;
  }
  const columns = Object.keys(rows[0]!);
  const cells = rows.map((row) => columns.map((column) => format(row[column])));
  const widths = columns.map((column, i) =>
    Math.max(column.length, ...cells.map((line) => line[i]!.length)),
  );
  const line = (values: string[]) =>
    "  " + values.map((value, i) => (i === 0 ? value.padEnd(widths[i]!) : value.padStart(widths[i]!))).join("  ");
  console.log(line(columns));
  console.log("  " + widths.map((width) => "-".repeat(width)).join("  "));
  for (const values of cells) console.log(line(values));
}

function format(value: unknown): string {
  if (value === null || value === undefined) return "0";
  if (value instanceof Date) return value.toLocaleTimeString("vi-VN");
  return String(value);
}

let stopped = false;
async function shutdown(): Promise<void> {
  stopped = true;
  await Promise.all(queues.map(({ queue }) => queue.close()));
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());

while (!stopped) {
  try {
    await render();
  } catch (error) {
    console.error("Lỗi khi đọc trạng thái:", error instanceof Error ? error.message : error);
  }
  await new Promise((resolve) => setTimeout(resolve, REFRESH_MS));
}
