/**
 * Stress test hàng chờ watermark: một shop lớn và vài shop nhỏ cùng chạy batch,
 * rồi đo tốc độ, độ công bằng giữa các shop và cửa sổ của từng shop.
 *
 *   npm run stress                                   # shop lớn 500 ảnh, 4 shop nhỏ 100 ảnh
 *   npm run stress -- --big 5000 --small 100 --small-shops 4
 *   npm run stress -- --resubmit-at 40               # shop lớn đổi thiết kế và chạy lại khi xong 40%
 *   npm run stress -- --clean                        # chỉ xóa dữ liệu của lần chạy trước
 *
 * App phải đang chạy (`npm run dev`): script chỉ tạo việc và đo, worker của app
 * mới là bên xử lý ảnh. Dữ liệu thử nằm trong các shop `*.stress.test` và bị xóa
 * khi chạy xong.
 *
 * Tùy chọn:
 *   --big <n>            số sản phẩm của shop lớn (mặc định 500, tối đa 5000)
 *   --small <n>          số sản phẩm của mỗi shop nhỏ (mặc định 100)
 *   --small-shops <n>    số shop nhỏ (mặc định 4, 0 = chỉ chạy shop lớn)
 *   --small-delay <s>    shop nhỏ vào sau shop lớn bao nhiêu giây (mặc định 10)
 *   --resubmit-at <%>    shop lớn tạo batch thứ hai (thiết kế khác) khi batch đầu xong chừng này %
 *   --images <n>         số ảnh mẫu khác nhau mỗi shop (mặc định 20)
 *   --size <px>          cạnh ảnh mẫu (mặc định 1200)
 *   --stall <s>          dừng nếu không có tiến triển sau chừng này giây (mặc định 120)
 *   --keep               giữ lại dữ liệu sau khi chạy để xem trên giao diện
 *   --clean              chỉ xóa dữ liệu stress test rồi thoát
 */
import { parseArgs } from "node:util";
import { Queue } from "bullmq";
import type { PrismaClient } from "../src/generated/prisma/client.ts";
import { EnqueueJob } from "../src/modules/jobs/application/EnqueueJob.ts";
import { BullMqJobQueue } from "../src/modules/jobs/infrastructure/BullMqJobQueue.ts";
import { redisRuntimeConfigFromEnv } from "../src/modules/jobs/infrastructure/RedisConnection.ts";
import type { MediaStorage } from "../src/modules/media/application/MediaPorts.ts";
import { CreateWatermarkBatch } from "../src/modules/watermark/application/CreateWatermarkBatch.ts";
import {
  BULK_SHOP_WINDOW,
  DispatchWatermarkBatch,
  INTERACTIVE_BATCH_LIMIT,
  INTERACTIVE_SHOP_WINDOW,
} from "../src/modules/watermark/application/DispatchWatermarkBatch.ts";
import type { WatermarkLayerProps } from "../src/modules/watermark/domain/WatermarkDesign.ts";
import { BullMqWatermarkQueue } from "../src/modules/watermark/infrastructure/BullMqWatermarkQueue.ts";
import { PrismaWatermarkBatchRepository } from "../src/modules/watermark/infrastructure/PrismaWatermarkBatchRepository.ts";
import { createPrismaClient } from "../src/shared/infrastructure/prisma.ts";
import { localMediaStorage, seedProducts } from "./seedProducts.ts";

const STRESS_DOMAIN_SUFFIX = ".stress.test";
const PRODUCT_TYPE = "Stress";
/** Giới hạn một batch theo loại sản phẩm (MAX_GROUP_JOBS trong CreateWatermarkBatch). */
const MAX_BATCH_PRODUCTS = 5_000;
const POLL_MS = 1_000;
const LAYERS: WatermarkLayerProps[] = [{ type: "TEXT", text: "STRESS", position: "CENTER", opacity: 0.5 }];
const RESUBMIT_LAYERS: WatermarkLayerProps[] = [
  { type: "TEXT", text: "STRESS V2", position: "BOTTOM_RIGHT", opacity: 0.8 },
];

const { values: args } = parseArgs({
  options: {
    big: { type: "string", default: "500" },
    small: { type: "string", default: "100" },
    "small-shops": { type: "string", default: "4" },
    "small-delay": { type: "string", default: "10" },
    "resubmit-at": { type: "string" },
    images: { type: "string", default: "20" },
    size: { type: "string", default: "1200" },
    stall: { type: "string", default: "120" },
    keep: { type: "boolean", default: false },
    clean: { type: "boolean", default: false },
  },
});

type JobStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED";

interface StressShop {
  id: string;
  domain: string;
  label: string;
  products: number;
  lane: "interactive" | "bulk";
  /** Số job tối đa shop được có trong queue cùng lúc. */
  window: number;
  /**
   * Cửa sổ là giới hạn mềm: nhiều job xong cùng lúc thì mỗi job đều tự bù chỗ,
   * nên có thể vượt tạm tối đa bằng số job worker chạy song song.
   */
  slack: number;
  maxInFlight: number;
}

interface TrackedBatch {
  label: string;
  shop: StressShop;
  batchId: string;
  total: number;
  createdAt: number;
  firstDoneAt: number | null;
  finishedAt: number | null;
  counts: Record<JobStatus, number>;
}

function integer(value: string | undefined, name: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} phải là số nguyên từ ${min} đến ${max}`);
  }
  return parsed;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const seconds = (ms: number) => (ms / 1000).toFixed(1);
const perMinute = (jobs: number, ms: number) => (ms > 0 ? Math.round((jobs * 60_000) / ms) : 0);

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Không chạy stress test trên môi trường production.");
  }
  const prisma = createPrismaClient();
  const storage = localMediaStorage();
  try {
    const removed = await cleanStressData(prisma, storage);
    if (args.clean) {
      console.log(`Đã xóa dữ liệu stress test của ${removed} shop.`);
      return;
    }
    await run(prisma, storage);
  } finally {
    await prisma.$disconnect();
  }
}

async function run(prisma: PrismaClient, storage: MediaStorage): Promise<void> {
  const big = integer(args.big, "--big", 1, MAX_BATCH_PRODUCTS);
  const small = integer(args.small, "--small", 1, MAX_BATCH_PRODUCTS);
  const smallShops = integer(args["small-shops"], "--small-shops", 0, 50);
  const smallDelayMs = integer(args["small-delay"], "--small-delay", 0) * 1000;
  const resubmitAt = args["resubmit-at"] === undefined ? null : integer(args["resubmit-at"], "--resubmit-at", 1, 99);
  const images = integer(args.images, "--images", 1);
  const size = integer(args.size, "--size", 16);
  const stallMs = integer(args.stall, "--stall", 5) * 1000;

  const redis = redisRuntimeConfigFromEnv();
  const workers = await requireWorkers(redis);
  const jobQueue = new BullMqJobQueue({
    queueNames: {
      interactive: redis.lanes.interactive.queueName,
      bulk: redis.lanes.bulk.queueName,
      system: redis.lanes.system.queueName,
    },
    connection: redis.producerConnection,
    prefix: redis.prefix,
  });
  const batches = new PrismaWatermarkBatchRepository(prisma);
  const createBatch = new CreateWatermarkBatch(
    batches,
    new DispatchWatermarkBatch(batches, new BullMqWatermarkQueue(new EnqueueJob(jobQueue), jobQueue)),
    // Batch theo loại sản phẩm không hỏi collection trên Shopify.
    { listProductIds: async () => null },
  );

  try {
    console.log(`Tạo dữ liệu thử: shop lớn ${big} sản phẩm, ${smallShops} shop nhỏ x ${small} sản phẩm...`);
    const shops: StressShop[] = [await createShop(prisma, "big", big, images, size)];
    for (let i = 1; i <= smallShops; i++) {
      shops.push(await createShop(prisma, `small-${i}`, small, images, size));
    }
    for (const shop of shops) shop.slack = workers[shop.lane] * redis.lanes[shop.lane].concurrency;
    const [bigShop, ...smallOnes] = shops as [StressShop, ...StressShop[]];

    const startedAt = Date.now();
    const tracked: TrackedBatch[] = [];
    const submit = async (shop: StressShop, label: string, layers: WatermarkLayerProps[]) => {
      const createdAt = Date.now();
      const batch = await createBatch.execute({
        shopDomain: shop.domain,
        selection: { kind: "PRODUCT_TYPE", productType: PRODUCT_TYPE },
        layers,
      });
      const entry: TrackedBatch = {
        label,
        shop,
        batchId: batch.id,
        total: batch.totalJobs,
        createdAt,
        firstDoneAt: null,
        finishedAt: null,
        counts: { PENDING: batch.totalJobs, PROCESSING: 0, COMPLETED: 0, FAILED: 0, CANCELLED: 0 },
      };
      tracked.push(entry);
      event(startedAt, `${label}: tạo batch ${batch.totalJobs} job (mất ${Date.now() - createdAt} ms)`);
      return entry;
    };

    const first = await submit(bigShop, "big", LAYERS);
    let smallSubmitted = smallOnes.length === 0;
    let resubmit: { at: number; completedBefore: number; entry: TrackedBatch } | null = null;
    const announced = new Set<string>();
    let lastChange = Date.now();
    let lastSignature = "";

    for (;;) {
      await sleep(POLL_MS);
      const now = Date.now();
      if (!smallSubmitted && now - startedAt >= smallDelayMs) {
        smallSubmitted = true;
        for (const shop of smallOnes) await submit(shop, shop.label, LAYERS);
      }
      await refresh(prisma, tracked, shops, now);
      if (resubmitAt !== null && !resubmit && first.counts.COMPLETED * 100 >= first.total * resubmitAt) {
        const completedBefore = first.counts.COMPLETED;
        resubmit = { at: now, completedBefore, entry: await submit(bigShop, "big (lần 2)", RESUBMIT_LAYERS) };
        await refresh(prisma, tracked, shops, Date.now());
      }
      for (const batch of tracked) {
        if (batch.finishedAt !== null && !announced.has(batch.batchId)) {
          announced.add(batch.batchId);
          event(startedAt, `${batch.label}: xong sau ${seconds(batch.finishedAt - batch.createdAt)} giây`);
        }
      }

      const done = tracked.reduce((sum, batch) => sum + batch.counts.COMPLETED, 0);
      const signature = JSON.stringify(tracked.map((batch) => batch.counts));
      if (signature !== lastSignature) {
        lastSignature = signature;
        lastChange = now;
      }
      process.stdout.write(
        `\r[${seconds(now - startedAt).padStart(7)}s] ` +
          tracked.map((batch) => `${batch.label} ${batch.counts.COMPLETED}/${batch.total}`).join(" | ") +
          ` | ${perMinute(done, now - startedAt)} ảnh/phút   `,
      );

      if (smallSubmitted && tracked.every((batch) => batch.finishedAt !== null)) break;
      if (now - lastChange > stallMs) {
        throw new Error(
          `Không có tiến triển trong ${stallMs / 1000} giây. Worker còn chạy không? ` +
            "Xem log của app hoặc chạy `npm run watch:queue`.",
        );
      }
    }
    process.stdout.write("\n");

    const failed = report(tracked, shops, startedAt, big, small, resubmit);
    if (failed > 0) process.exitCode = 1;
  } finally {
    process.stdout.write("\n");
    await jobQueue.close();
    if (args.keep) {
      console.log("Giữ lại dữ liệu (--keep). Xóa bằng: npm run stress -- --clean");
    } else {
      await cleanStressData(prisma, storage);
      console.log("Đã xóa dữ liệu stress test.");
    }
  }
}

/** Đọc trạng thái job của các batch đang theo dõi và số job đang nằm trong queue của từng shop. */
async function refresh(
  prisma: PrismaClient,
  tracked: TrackedBatch[],
  shops: StressShop[],
  now: number,
): Promise<void> {
  const [byBatch, inFlight] = await Promise.all([
    prisma.watermarkJob.groupBy({
      by: ["batchId", "status"],
      where: { batchId: { in: tracked.map((batch) => batch.batchId) } },
      _count: { _all: true },
    }),
    prisma.watermarkJob.groupBy({
      by: ["shopId"],
      where: {
        shopId: { in: shops.map((shop) => shop.id) },
        OR: [{ status: "PROCESSING" }, { status: "PENDING", enqueuedAt: { not: null } }],
      },
      _count: { _all: true },
    }),
  ]);
  for (const batch of tracked) {
    batch.counts = { PENDING: 0, PROCESSING: 0, COMPLETED: 0, FAILED: 0, CANCELLED: 0 };
    for (const row of byBatch) {
      if (row.batchId === batch.batchId) batch.counts[row.status] = row._count._all;
    }
    if (batch.firstDoneAt === null && batch.counts.COMPLETED > 0) batch.firstDoneAt = now;
    if (batch.finishedAt === null && batch.counts.PENDING + batch.counts.PROCESSING === 0) {
      batch.finishedAt = now;
    }
  }
  for (const shop of shops) {
    const current = inFlight.find((row) => row.shopId === shop.id)?._count._all ?? 0;
    shop.maxInFlight = Math.max(shop.maxInFlight, current);
  }
}

/** In kết quả và các phép kiểm tra; trả về số phép kiểm tra không đạt. */
function report(
  tracked: TrackedBatch[],
  shops: StressShop[],
  startedAt: number,
  big: number,
  small: number,
  resubmit: { at: number; completedBefore: number; entry: TrackedBatch } | null,
): number {
  const endedAt = Math.max(...tracked.map((batch) => batch.finishedAt ?? Date.now()));
  const completed = tracked.reduce((sum, batch) => sum + batch.counts.COMPLETED, 0);

  console.log("\nKết quả từng batch");
  console.table(
    tracked.map((batch) => ({
      batch: batch.label,
      job: batch.total,
      xong: batch.counts.COMPLETED,
      loi: batch.counts.FAILED,
      huy: batch.counts.CANCELLED,
      "cho_anh_dau (s)": batch.firstDoneAt === null ? "-" : seconds(batch.firstDoneAt - batch.createdAt),
      "tong (s)": seconds((batch.finishedAt ?? endedAt) - batch.createdAt),
    })),
  );
  console.log("Từng shop");
  console.table(
    shops.map((shop) => ({ shop: shop.label, lane: shop.lane, cua_so: shop.window, trong_queue_nhieu_nhat: shop.maxInFlight })),
  );
  console.log(
    `Tổng: ${completed} ảnh trong ${seconds(endedAt - startedAt)} giây, ` +
      `trung bình ${perMinute(completed, endedAt - startedAt)} ảnh/phút.`,
  );

  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  const failedJobs = tracked.reduce((sum, batch) => sum + batch.counts.FAILED, 0);
  checks.push({ name: "Không job nào lỗi", ok: failedJobs === 0, detail: `${failedJobs} job lỗi` });

  const overflowing = shops.filter((shop) => shop.maxInFlight > shop.window + shop.slack);
  checks.push({
    name: "Không shop nào vượt cửa sổ của mình",
    ok: overflowing.length === 0,
    detail:
      shops.map((shop) => `${shop.label} ${shop.maxInFlight}/${shop.window}`).join(", ") +
      `; cho phép vượt tạm ${Math.max(...shops.map((shop) => shop.slack))}`,
  });

  const smallBatches = tracked.filter((batch) => batch.shop.label !== "big");
  if (smallBatches.length > 0 && big > small) {
    const bigEnd = Math.max(...tracked.filter((batch) => batch.shop.label === "big").map((batch) => batch.finishedAt ?? endedAt));
    const late = smallBatches.filter((batch) => (batch.finishedAt ?? endedAt) >= bigEnd);
    checks.push({
      name: "Shop nhỏ xong trước shop lớn",
      ok: late.length === 0,
      detail: late.map((batch) => batch.label).join(", ") || `shop nhỏ chậm nhất xong sau ${seconds(Math.max(...smallBatches.map((batch) => batch.finishedAt ?? endedAt)) - startedAt)} giây`,
    });
  }

  if (resubmit) {
    const first = tracked[0]!;
    const wasted = first.counts.COMPLETED - resubmit.completedBefore;
    checks.push({
      name: "Chạy lại thì job còn chờ của lần 1 bị hủy",
      ok: first.counts.CANCELLED > 0 && wasted <= first.shop.window,
      detail: `${first.counts.CANCELLED} job bị hủy, ${wasted} job của lần 1 vẫn chạy xong sau khi có lần 2`,
    });
  }

  console.log("\nKiểm tra");
  for (const check of checks) console.log(`  ${check.ok ? "ĐẠT   " : "KHÔNG "} ${check.name} (${check.detail})`);
  return checks.filter((check) => !check.ok).length;
}

async function createShop(
  prisma: PrismaClient,
  label: string,
  products: number,
  images: number,
  size: number,
): Promise<StressShop> {
  const shop = await prisma.shop.create({
    data: { domain: `${label}${STRESS_DOMAIN_SUFFIX}` },
    select: { id: true, domain: true },
  });
  await seedProducts(prisma, shop, {
    count: products,
    type: PRODUCT_TYPE,
    perType: MAX_BATCH_PRODUCTS,
    images: Math.min(images, products),
    size,
  });
  const small = products <= INTERACTIVE_BATCH_LIMIT;
  return {
    ...shop,
    label,
    products,
    lane: small ? "interactive" : "bulk",
    window: small ? INTERACTIVE_SHOP_WINDOW : BULK_SHOP_WINDOW,
    slack: 0,
    maxInFlight: 0,
  };
}

/** Xóa mọi shop `*.stress.test` cùng job, sản phẩm và file ảnh của chúng. Trả về số shop đã xóa. */
async function cleanStressData(prisma: PrismaClient, storage: MediaStorage): Promise<number> {
  const shops = await prisma.shop.findMany({
    where: { domain: { endsWith: STRESS_DOMAIN_SUFFIX } },
    select: { id: true },
  });
  for (const shop of shops) {
    const assets = await prisma.mediaAsset.findMany({ where: { shopId: shop.id }, select: { storageKey: true } });
    // Job trỏ tới sản phẩm và thiết kế bằng khóa ngoại RESTRICT, nên phải xóa job trước.
    await prisma.watermarkJob.deleteMany({ where: { shopId: shop.id } });
    await prisma.watermarkBatch.deleteMany({ where: { shopId: shop.id } });
    await prisma.mediaAsset.deleteMany({ where: { shopId: shop.id } });
    await prisma.catalogProduct.deleteMany({ where: { shopId: shop.id } });
    await prisma.watermarkDesign.deleteMany({ where: { shopId: shop.id } });
    await prisma.shop.delete({ where: { id: shop.id } });
    for (const asset of assets) await storage.delete(asset.storageKey);
  }
  return shops.length;
}

/**
 * Đếm worker đang nghe hai lane watermark. Không có worker nào thì batch sẽ nằm
 * chờ mãi, nên báo ngay từ đầu.
 */
async function requireWorkers(
  redis: ReturnType<typeof redisRuntimeConfigFromEnv>,
): Promise<Record<"interactive" | "bulk", number>> {
  const counts = { interactive: 0, bulk: 0 };
  for (const lane of ["interactive", "bulk"] as const) {
    const queue = new Queue(redis.lanes[lane].queueName, {
      connection: redis.producerConnection,
      prefix: redis.prefix,
    });
    try {
      counts[lane] = await queue.getWorkersCount();
      if (counts[lane] === 0) {
        throw new Error(`Không có worker nào đang nghe lane ${lane}. Hãy bật app (npm run dev) rồi chạy lại.`);
      }
    } finally {
      await queue.close();
    }
  }
  return counts;
}

function event(startedAt: number, message: string): void {
  process.stdout.write(`\r[${seconds(Date.now() - startedAt).padStart(7)}s] ${message}`.padEnd(100) + "\n");
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
