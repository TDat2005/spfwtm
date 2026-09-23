import { describe, expect, it, vi } from "vitest";
import { WatermarkJob } from "../domain/WatermarkJob.ts";
import { ProcessWatermarkJob } from "./ProcessWatermarkJob.ts";
import type {
  WatermarkJobRepository,
  WatermarkMediaGateway,
  WatermarkProcessor,
} from "./WatermarkPorts.ts";

function processingJob(): WatermarkJob {
  return new WatermarkJob({
    id: "watermark-1",
    shopDomain: "demo.myshopify.com",
    productId: "gid://shopify/Product/1",
    sourceImageUrl: "https://cdn.example.com/product.jpg",
    configuration: {
      type: "TEXT",
      text: "Demo",
      position: "BOTTOM_RIGHT",
      opacity: 0.7,
    },
    status: "PROCESSING",
  });
}

function dependencies(job: WatermarkJob) {
  const save = vi.fn(async () => undefined);
  const repository: WatermarkJobRepository = {
    save,
    findByIdForShop: vi.fn(async () => job),
    listByShop: vi.fn(async () => [job]),
  };
  const media: WatermarkMediaGateway = {
    importSource: vi.fn(async () => Buffer.from("source")),
    storeResult: vi.fn(async () => "result-media-1"),
  };
  const processor: WatermarkProcessor = {
    applyText: vi.fn(async () => ({
      bytes: Buffer.from("result"),
      mimeType: "image/webp",
    })),
    applyImage: vi.fn(async () => ({
      bytes: Buffer.from("result"),
      mimeType: "image/webp",
    })),
  };

  return { repository, media, processor, save };
}

describe("ProcessWatermarkJob stalled recovery", () => {
  it("không chạy chồng khi request thường gặp job đang PROCESSING", async () => {
    const job = processingJob();
    const deps = dependencies(job);
    const useCase = new ProcessWatermarkJob(
      deps.repository,
      deps.media,
      deps.processor
    );

    const result = await useCase.execute(job.id, job.shopDomain);

    expect(result.status).toBe("PROCESSING");
    expect(deps.processor.applyText).not.toHaveBeenCalled();
  });

  it("cho BullMQ tiếp tục job PROCESSING sau khi worker cũ bị stalled", async () => {
    const job = processingJob();
    const deps = dependencies(job);
    const useCase = new ProcessWatermarkJob(
      deps.repository,
      deps.media,
      deps.processor
    );

    const result = await useCase.execute(job.id, job.shopDomain, {
      resumeProcessing: true,
    });

    expect(result.status).toBe("COMPLETED");
    expect(result.resultMediaId).toBe("result-media-1");
    expect(deps.processor.applyText).toHaveBeenCalledOnce();
    expect(deps.save).toHaveBeenCalledOnce();
  });
});
