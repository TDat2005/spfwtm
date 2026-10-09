import { describe, expect, it, vi } from "vitest";
import { WatermarkJob, type WatermarkLayerProps } from "../domain/WatermarkJob.ts";
import { ProcessWatermarkJob } from "./ProcessWatermarkJob.ts";
import type {
  WatermarkJobRepository,
  WatermarkMediaGateway,
  WatermarkProcessor,
} from "./WatermarkPorts.ts";

const SHOP = "a.myshopify.com";

const layer: WatermarkLayerProps = {
  enabled: true,
  type: "TEXT",
  text: "Sale",
  logoUrl: null,
  logoScale: 0.2,
  position: "BOTTOM_RIGHT",
  opacity: 0.7,
  layout: "SINGLE",
  rotation: 0,
  offsetX: 0,
  offsetY: 0,
  fontFamily: "Arial",
  fontSize: 0.045,
  textColor: "#FFFFFF",
  strokeColor: "#000000",
  strokeWidth: 2,
};

function setup(status: WatermarkJob["status"] = "PENDING") {
  let stored = new WatermarkJob({
    id: "job-1",
    shopDomain: SHOP,
    productId: "gid://shopify/Product/1",
    sourceImageUrl: "https://cdn.shopify.com/a.jpg",
    design: [layer],
    status,
  });
  const repository: WatermarkJobRepository = {
    findByIdForShop: async () => stored,
    save: vi.fn(async (job: WatermarkJob) => {
      stored = job;
    }),
    listPageByShop: async () => ({ items: [], total: 0 }),
  };
  const media: WatermarkMediaGateway = {
    importSource: vi.fn(async () => {
      throw new Error("Tải ảnh thất bại");
    }),
    importLogo: async () => Buffer.alloc(0),
    storeResult: async () => "media-1",
  };
  const processor: WatermarkProcessor = {
    render: async () => ({ bytes: Buffer.alloc(0), mimeType: "image/webp" }),
  };
  return {
    useCase: new ProcessWatermarkJob(repository, media, processor),
    current: () => stored,
  };
}

describe("ProcessWatermarkJob", () => {
  it("lỗi khi còn lượt retry thì job vẫn PROCESSING", async () => {
    const { useCase, current } = setup();

    await expect(
      useCase.execute("job-1", SHOP, { resumeProcessing: true, finalAttempt: false }),
    ).rejects.toThrow("Tải ảnh thất bại");

    expect(current().status).toBe("PROCESSING");
    expect(current().errorMessage).toBeNull();
  });

  it("lỗi ở lần thử cuối thì job chuyển FAILED", async () => {
    const { useCase, current } = setup("PROCESSING");

    await expect(
      useCase.execute("job-1", SHOP, { resumeProcessing: true, finalAttempt: true }),
    ).rejects.toThrow("Tải ảnh thất bại");

    expect(current().status).toBe("FAILED");
    expect(current().errorMessage).toBe("Tải ảnh thất bại");
  });

  it("gọi trực tiếp (không qua queue) vẫn đánh FAILED khi lỗi", async () => {
    const { useCase, current } = setup();

    await expect(useCase.execute("job-1", SHOP)).rejects.toThrow();
    expect(current().status).toBe("FAILED");
  });
});
