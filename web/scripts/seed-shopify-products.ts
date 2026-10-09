/**
 * Tạo sản phẩm thử CÓ ẢNH trên shop Shopify thật (development store) đã cài app,
 * để test watermark/queue với nhiều shop.
 *
 *   npm run seed:shopify -- --list
 *   npm run seed:shopify -- --shop shop-a --count 10000
 *   npm run seed:shopify -- --shop shop-b --count 100 --type "Shop B"
 *   npm run seed:shopify -- --shop shop-a --clean
 *
 * Tùy chọn:
 *   --shop <shop>        shop-a hoặc shop-a.myshopify.com (app phải đã cài trên shop)
 *   --count <n>          số sản phẩm (mặc định 50)
 *   --type <tên>         tiền tố product type (mặc định "Seed")
 *   --per-type <n>       số sản phẩm mỗi product type (mặc định 5000 = giới hạn một batch)
 *   --images <n>         số ảnh mẫu upload lên Shopify (mặc định 10)
 *   --size <px>          cạnh ảnh mẫu (mặc định 1200)
 *   --concurrency <n>    số request song song (mặc định 4)
 *   --clean              xóa mọi sản phẩm có tag `watermark-seed` trên shop
 *
 * Dùng access token offline app lưu khi cài (web/database.sqlite). Chỉ vài ảnh
 * mẫu được upload; các sản phẩm còn lại dùng lại URL CDN của chúng, nên Shopify
 * không phải nhận hàng nghìn file. Tốc độ bị giới hạn bởi rate limit của Admin
 * API (khoảng 5–10 sản phẩm/giây).
 */
import { join } from "node:path";
import { parseArgs } from "node:util";
import sqlite3 from "sqlite3";
import { positiveInteger, productTypeFor, sampleImage } from "./sampleImages.ts";

/** Cùng SHOPIFY_API_VERSION trong shopify.js (scripts/check-api-version.mjs kiểm tra). */
const API_VERSION = "2026-07";
const SEED_TAG = "watermark-seed";
const MAX_ATTEMPTS = 6;
const MEDIA_READY_TIMEOUT_MS = 5 * 60 * 1000;

const { values: args } = parseArgs({
  options: {
    shop: { type: "string" },
    list: { type: "boolean", default: false },
    count: { type: "string", default: "50" },
    type: { type: "string", default: "Seed" },
    "per-type": { type: "string", default: "5000" },
    images: { type: "string", default: "10" },
    size: { type: "string", default: "1200" },
    concurrency: { type: "string", default: "4" },
    clean: { type: "boolean", default: false },
  },
});

interface GraphqlResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
  extensions?: {
    cost?: {
      requestedQueryCost: number;
      throttleStatus: { currentlyAvailable: number; restoreRate: number };
    };
  };
}

interface UserError {
  field: string[] | null;
  message: string;
}

class AdminClient {
  constructor(
    private readonly shop: string,
    private readonly accessToken: string,
  ) {}

  async request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const response = await fetch(`https://${this.shop}/admin/api/${API_VERSION}/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": this.accessToken },
        body: JSON.stringify({ query, variables }),
      });
      if ((response.status === 429 || response.status >= 500) && attempt < MAX_ATTEMPTS) {
        await sleep(Number(response.headers.get("retry-after") ?? 0) * 1000 || 1000 * attempt);
        continue;
      }
      if (!response.ok) {
        throw new Error(`Shopify trả về HTTP ${response.status}: ${await response.text()}`);
      }

      const body = (await response.json()) as GraphqlResponse<T>;
      await this.pace(body.extensions?.cost);
      if (body.errors?.some((error) => error.extensions?.code === "THROTTLED") && attempt < MAX_ATTEMPTS) {
        await sleep(1000);
        continue;
      }
      if (body.errors?.length || !body.data) {
        throw new Error(body.errors?.map((error) => error.message).join("; ") ?? "Shopify không trả về data");
      }
      return body.data;
    }
  }

  /** Bucket gần cạn thì chờ cho đầy lại, thay vì để Shopify trả THROTTLED. */
  private async pace(cost: NonNullable<GraphqlResponse<unknown>["extensions"]>["cost"]): Promise<void> {
    if (!cost) return;
    const reserve = Math.max(100, cost.requestedQueryCost * 4);
    const { currentlyAvailable, restoreRate } = cost.throttleStatus;
    if (currentlyAvailable < reserve && restoreRate > 0) {
      await sleep(((reserve - currentlyAvailable) / restoreRate) * 1000);
    }
  }
}

const STAGED_UPLOAD = `
  mutation SeedStagedUpload($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url resourceUrl parameters { name value } }
      userErrors { field message }
    }
  }
`;

const PRODUCT_CREATE = `
  mutation SeedProductCreate($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
    productCreate(product: $product, media: $media) {
      product { id }
      userErrors { field message }
    }
  }
`;

const PRODUCT_MEDIA = `
  query SeedProductMedia($id: ID!) {
    product(id: $id) {
      media(first: 1) {
        nodes { status ... on MediaImage { image { url } } }
      }
    }
  }
`;

const SEED_PRODUCTS = `
  query SeedProducts($query: String!) {
    products(first: 100, query: $query) { nodes { id } }
  }
`;

const PRODUCT_DELETE = `
  mutation SeedProductDelete($input: ProductDeleteInput!) {
    productDelete(input: $input) {
      deletedProductId
      userErrors { field message }
    }
  }
`;

async function main(): Promise<void> {
  const sessions = await loadOfflineSessions();
  if (args.list || !args.shop) {
    console.log(
      sessions.size === 0
        ? "Chưa shop nào cài app. Cài app lên dev store trước (xem hướng dẫn)."
        : `Shop đã cài app:\n${[...sessions.keys()].map((shop) => `  - ${shop}`).join("\n")}`,
    );
    if (!args.list) console.log("\nChạy lại với --shop <shop>.");
    return;
  }

  const shop = args.shop.includes(".") ? args.shop.trim() : `${args.shop.trim()}.myshopify.com`;
  const session = sessions.get(shop);
  if (!session) {
    throw new Error(`App chưa cài trên ${shop} (không có session offline). Dùng --list để xem shop đã cài.`);
  }
  if (!session.scope.split(",").includes("write_products")) {
    throw new Error(`Session của ${shop} thiếu scope write_products (đang là "${session.scope}").`);
  }
  const client = new AdminClient(shop, session.accessToken);

  if (args.clean) {
    await clean(client, shop);
    return;
  }

  const count = positiveInteger(args.count, "--count");
  const perType = positiveInteger(args["per-type"], "--per-type");
  const imageCount = Math.min(positiveInteger(args.images, "--images"), count);
  const size = positiveInteger(args.size, "--size");
  const concurrency = positiveInteger(args.concurrency, "--concurrency");
  const productInput = (index: number) => ({
    title: `Sản phẩm thử #${index + 1}`,
    productType: productTypeFor(index, count, perType, args.type!),
    status: "ACTIVE",
    tags: [SEED_TAG],
  });

  console.log(`Upload ${imageCount} ảnh mẫu lên ${shop}...`);
  const poolProductIds: string[] = [];
  for (let i = 0; i < imageCount; i++) {
    const resourceUrl = await uploadImage(client, await sampleImage(i, imageCount, size), `seed-${i + 1}.jpg`);
    poolProductIds.push(await createProduct(client, productInput(i), resourceUrl));
  }
  const imageUrls = await waitForImages(client, poolProductIds);

  let created = imageCount;
  const remaining = Array.from({ length: count - imageCount }, (_, i) => imageCount + i);
  await runPool(remaining, concurrency, async (index) => {
    await createProduct(client, productInput(index), imageUrls[index % imageUrls.length]!);
    created += 1;
    process.stdout.write(`\rĐã tạo ${created}/${count} sản phẩm`);
  });

  const types = [...new Set(Array.from({ length: count }, (_, i) => productInput(i).productType))];
  console.log(`\nXong. Product type: ${types.map((type) => `"${type}"`).join(", ")}.`);
  console.log("Ảnh của sản phẩm cần vài phút để Shopify xử lý xong. Sau đó vào app bấm đồng bộ catalog.");
}

async function uploadImage(client: AdminClient, bytes: Buffer, filename: string): Promise<string> {
  const data = await client.request<{
    stagedUploadsCreate: {
      stagedTargets: Array<{ url: string; resourceUrl: string; parameters: Array<{ name: string; value: string }> }>;
      userErrors: UserError[];
    };
  }>(STAGED_UPLOAD, {
    input: [{ resource: "IMAGE", filename, mimeType: "image/jpeg", httpMethod: "POST", fileSize: String(bytes.length) }],
  });
  throwOnUserErrors(data.stagedUploadsCreate.userErrors);
  const target = data.stagedUploadsCreate.stagedTargets[0];
  if (!target) throw new Error("Shopify không tạo staged upload target");

  const form = new FormData();
  for (const parameter of target.parameters) form.append(parameter.name, parameter.value);
  form.append("file", new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }), filename);
  const response = await fetch(target.url, { method: "POST", body: form });
  if (!response.ok) throw new Error(`Upload ảnh thất bại: HTTP ${response.status} ${await response.text()}`);
  return target.resourceUrl;
}

async function createProduct(
  client: AdminClient,
  product: Record<string, unknown>,
  imageSource: string,
): Promise<string> {
  const data = await client.request<{
    productCreate: { product: { id: string } | null; userErrors: UserError[] };
  }>(PRODUCT_CREATE, {
    product,
    media: [{ originalSource: imageSource, mediaContentType: "IMAGE", alt: String(product.title) }],
  });
  throwOnUserErrors(data.productCreate.userErrors);
  if (!data.productCreate.product) throw new Error("Shopify không trả về sản phẩm vừa tạo");
  return data.productCreate.product.id;
}

/** Chờ ảnh mẫu xử lý xong để lấy URL CDN, dùng làm nguồn ảnh cho các sản phẩm còn lại. */
async function waitForImages(client: AdminClient, productIds: string[]): Promise<string[]> {
  const deadline = Date.now() + MEDIA_READY_TIMEOUT_MS;
  const urls = new Map<string, string>();
  while (urls.size < productIds.length) {
    if (Date.now() > deadline) throw new Error("Quá 5 phút mà Shopify chưa xử lý xong ảnh mẫu");
    for (const id of productIds.filter((id) => !urls.has(id))) {
      const data = await client.request<{
        product: { media: { nodes: Array<{ status: string; image?: { url: string } | null }> } } | null;
      }>(PRODUCT_MEDIA, { id });
      const media = data.product?.media.nodes[0];
      if (media?.status === "FAILED") throw new Error(`Shopify không xử lý được ảnh của ${id}`);
      if (media?.status === "READY" && media.image?.url) urls.set(id, media.image.url);
    }
    if (urls.size < productIds.length) await sleep(2000);
  }
  return productIds.map((id) => urls.get(id)!);
}

async function clean(client: AdminClient, shop: string): Promise<void> {
  let deleted = 0;
  const concurrency = positiveInteger(args.concurrency, "--concurrency");
  for (let emptyRounds = 0; emptyRounds < 3; ) {
    const data = await client.request<{ products: { nodes: Array<{ id: string }> } }>(SEED_PRODUCTS, {
      query: `tag:${SEED_TAG}`,
    });
    if (data.products.nodes.length === 0) {
      // Chỉ mục tìm kiếm của Shopify cập nhật chậm: kiểm tra lại vài lần cho chắc.
      emptyRounds += 1;
      await sleep(3000);
      continue;
    }
    emptyRounds = 0;
    await runPool(data.products.nodes, concurrency, async ({ id }) => {
      const result = await client.request<{
        productDelete: { deletedProductId: string | null; userErrors: UserError[] };
      }>(PRODUCT_DELETE, { input: { id } });
      if (result.productDelete.deletedProductId) deleted += 1;
      process.stdout.write(`\rĐã xóa ${deleted} sản phẩm`);
    });
  }
  console.log(`\nĐã xóa ${deleted} sản phẩm thử trên ${shop}.`);
}

/** Session offline app đã lưu (shop → token), đọc thẳng từ SQLite session storage. */
async function loadOfflineSessions(): Promise<Map<string, { accessToken: string; scope: string }>> {
  const db = new sqlite3.Database(join(process.cwd(), "database.sqlite"), sqlite3.OPEN_READONLY);
  try {
    const rows = await new Promise<Array<{ shop: string; accessToken: string; scope: string | null }>>(
      (resolve, reject) =>
        db.all(
          "SELECT shop, accessToken, scope FROM shopify_sessions WHERE isOnline = 0",
          (error: Error | null, result: Array<{ shop: string; accessToken: string; scope: string | null }>) =>
            error ? reject(error) : resolve(result),
        ),
    );
    return new Map(rows.map((row) => [row.shop, { accessToken: row.accessToken, scope: row.scope ?? "" }]));
  } finally {
    db.close();
  }
}

async function runPool<T>(items: T[], concurrency: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++]!;
        await work(item);
      }
    }),
  );
}

function throwOnUserErrors(errors: UserError[]): void {
  if (errors.length > 0) throw new Error(errors.map((error) => error.message).join("; "));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
