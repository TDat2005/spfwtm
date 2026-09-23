import { describe, expect, it } from "vitest";
import { WatermarkConfiguration, WatermarkJob } from "./WatermarkJob.ts";

describe("WatermarkConfiguration", () => {
  it("chuẩn hóa cấu hình text tại domain boundary", () => {
    const configuration = new WatermarkConfiguration({
      type: "TEXT",
      text: "  © My shop  ",
      position: "BOTTOM_CENTER",
      opacity: 0.7,
      textColor: "#ffffff",
      layout: "TILED",
    });

    expect(configuration.text).toBe("© My shop");
    expect(configuration.textColor).toBe("#FFFFFF");
    expect(configuration.logoUrl).toBeNull();
    expect(configuration.layout).toBe("TILED");
  });

  it("từ chối cấu hình sai thay vì để lỗi chạy xuống Sharp", () => {
    expect(
      () =>
        new WatermarkConfiguration({
          type: "TEXT",
          text: "",
          position: "CENTER",
          opacity: 0.7,
        })
    ).toThrow("Nội dung watermark không được để trống");

    expect(
      () =>
        new WatermarkConfiguration({
          type: "IMAGE",
          logoUrl: "http://insecure.example/logo.png",
          position: "CENTER",
          opacity: 0.7,
        })
    ).toThrow("Nguồn logo không hợp lệ");
  });
});

describe("WatermarkJob", () => {
  it("bảo vệ vòng đời PENDING -> PROCESSING -> COMPLETED", () => {
    const job = createJob();
    job.start();
    job.complete("result-media-id");

    expect(job.status).toBe("COMPLETED");
    expect(job.resultMediaId).toBe("result-media-id");
    expect(() => job.start()).toThrow("Chỉ job đang chờ mới có thể bắt đầu");
  });

  it("chỉ retry job đã thất bại", () => {
    const job = createJob();
    job.start();
    job.fail("temporary error");
    job.retry();

    expect(job.status).toBe("PENDING");
    expect(job.errorMessage).toBeNull();
  });

  it("cho phép hủy job chưa bắt đầu", () => {
    const job = createJob();
    job.cancel();
    expect(job.status).toBe("CANCELLED");
    expect(() => job.start()).toThrow("Chỉ job đang chờ mới có thể bắt đầu");
  });
});

function createJob(): WatermarkJob {
  return new WatermarkJob({
    id: "job-1",
    shopDomain: "example.myshopify.com",
    productId: "gid://shopify/Product/1",
    sourceImageUrl: "https://cdn.shopify.com/product.png",
    configuration: {
      type: "TEXT",
      text: "© My shop",
      position: "BOTTOM_RIGHT",
      opacity: 0.7,
    },
  });
}
