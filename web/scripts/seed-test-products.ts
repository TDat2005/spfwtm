/**
 * Tạo sản phẩm thử cho một shop để test watermark và queue với dữ liệu thật,
 * không cần gọi Shopify.
 *
 *   npm run seed:products -- --email a@test.com --count 10000
 *   npm run seed:products -- --email b@test.com --count 100 --type "Shop B"
 *   npm run seed:products -- --email a@test.com --clean
 *
 * Tùy chọn:
 *   --email <email>      tài khoản chế độ độc lập (đăng ký trên giao diện trước)
 *   --shop <domain>      hoặc chỉ định thẳng domain shop đã có trong DB
 *   --count <n>          số sản phẩm (mặc định 100)
 *   --type <tên>         tiền tố product type (mặc định "Seed")
 *   --per-type <n>       số sản phẩm mỗi product type (mặc định 5000 = giới hạn một batch)
 *   --images <n>         số ảnh mẫu khác nhau dùng chung (mặc định 20)
 *   --size <px>          cạnh ảnh mẫu (mặc định 1200)
 *   --clean              xóa (mềm) mọi sản phẩm do script tạo cho shop
 *
 * Sản phẩm là "ảnh tải lên" (`upload-seed-...`), nên luồng watermark đọc ảnh từ
 * storage cục bộ như ảnh thật. Nhiều sản phẩm dùng chung một bộ ảnh nhỏ, nên
 * 10.000 sản phẩm chỉ tốn vài MB.
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { PrismaClient } from "../src/generated/prisma/client.ts";
import { MediaService } from "../src/modules/media/application/MediaService.ts";
import { FetchRemoteImageDownloader } from "../src/modules/media/infrastructure/FetchRemoteImageDownloader.ts";
import { LocalMediaStorage } from "../src/modules/media/infrastructure/LocalMediaStorage.ts";
import { PrismaMediaAssetRepository } from "../src/modules/media/infrastructure/PrismaMediaAssetRepository.ts";
import { Sha256ContentHasher } from "../src/modules/media/infrastructure/Sha256ContentHasher.ts";
import { UPLOADED_PRODUCT_PREFIX } from "../src/modules/standalone/domain/UploadedImage.ts";
import { createPrismaClient } from "../src/shared/infrastructure/prisma.ts";
import { positiveInteger, productTypeFor, sampleImage } from "./sampleImages.ts";

const SEED_PREFIX = `${UPLOADED_PRODUCT_PREFIX}seed-`;
const INSERT_CHUNK = 1_000;

const { values: args } = parseArgs({
  options: {
    email: { type: "string" },
    shop: { type: "string" },
    count: { type: "string", default: "100" },
    type: { type: "string", default: "Seed" },
    "per-type": { type: "string", default: "5000" },
    images: { type: "string", default: "20" },
    size: { type: "string", default: "1200" },
    clean: { type: "boolean", default: false },
  },
});

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  try {
    const shop = await findShop(prisma);
    if (args.clean) {
      const { count } = await prisma.catalogProduct.updateMany({
        where: { shopId: shop.id, shopifyProductId: { startsWith: SEED_PREFIX }, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      console.log(`Đã xóa ${count} sản phẩm thử của ${shop.domain}.`);
      return;
    }

    const count = positiveInteger(args.count, "--count");
    const perType = positiveInteger(args["per-type"], "--per-type");
    const imageCount = Math.min(positiveInteger(args.images, "--images"), count);
    const size = positiveInteger(args.size, "--size");

    console.log(`Tạo ${imageCount} ảnh mẫu ${size}x${size}...`);
    const media = new MediaService(
      new FetchRemoteImageDownloader(),
      new LocalMediaStorage(join(process.cwd(), "storage", "media")),
      new Sha256ContentHasher(),
      new PrismaMediaAssetRepository(prisma),
    );
    const imageUrls: string[] = [];
    for (let i = 0; i < imageCount; i++) {
      const asset = await media.storeUploaded(shop.domain, await sampleImage(i, imageCount, size), "image/jpeg");
      imageUrls.push(`/api/media/assets/${asset.id}/content`);
    }

    const runId = new Date().toISOString().slice(5, 16).replace("T", " ");
    const products = Array.from({ length: count }, (_, i) => {
      const imageUrl = imageUrls[i % imageUrls.length]!;
      return {
        shopId: shop.id,
        shopifyProductId: `${SEED_PREFIX}${randomUUID()}`,
        title: `Sản phẩm thử #${i + 1} (${runId})`,
        status: "ACTIVE" as const,
        productType: productTypeFor(i, count, perType, args.type!),
        imageUrl,
        originalImageUrl: imageUrl,
      };
    });
    for (let i = 0; i < products.length; i += INSERT_CHUNK) {
      await prisma.catalogProduct.createMany({ data: products.slice(i, i + INSERT_CHUNK) });
      process.stdout.write(`\rĐã tạo ${Math.min(i + INSERT_CHUNK, products.length)}/${count} sản phẩm`);
    }

    const types = [...new Set(products.map((product) => product.productType))];
    console.log(`\nXong. Shop ${shop.domain}, product type: ${types.map((t) => `"${t}"`).join(", ")}.`);
    console.log("Tạo batch watermark theo từng product type trên giao diện để chạy thử.");
  } finally {
    await prisma.$disconnect();
  }
}

async function findShop(prisma: PrismaClient): Promise<{ id: string; domain: string }> {
  if (args.email) {
    const account = await prisma.account.findUnique({
      where: { email: args.email.trim().toLowerCase() },
      select: { shop: { select: { id: true, domain: true } } },
    });
    if (!account) {
      throw new Error(`Không có tài khoản ${args.email}. Hãy đăng ký trên giao diện chế độ độc lập trước.`);
    }
    return account.shop;
  }
  if (args.shop) {
    const shop = await prisma.shop.findUnique({
      where: { domain: args.shop.trim() },
      select: { id: true, domain: true },
    });
    if (!shop) throw new Error(`Không có shop ${args.shop} trong DB.`);
    return shop;
  }
  throw new Error("Cần --email <email> hoặc --shop <domain>.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
