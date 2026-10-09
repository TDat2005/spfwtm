import { describe, expect, it } from "vitest";
import { WatermarkJob, type WatermarkLayerProps } from "./WatermarkJob.ts";

const layer: WatermarkLayerProps = {
  enabled: true,
  type: "TEXT",
  text: "© Shop",
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

const jobWithSource = (sourceImageUrl: string) =>
  new WatermarkJob({ id: "job-1", shopDomain: "shop", productId: "p-1", sourceImageUrl, design: [layer] });

describe("WatermarkJob source URL", () => {
  it("nhận ảnh HTTPS (Shopify) và media đã lưu trong app (ảnh tải lên)", () => {
    expect(jobWithSource("https://cdn.shopify.com/a.jpg").sourceImageUrl).toBe("https://cdn.shopify.com/a.jpg");
    expect(jobWithSource("/api/media/assets/89350cf8-2b15/content").sourceImageUrl).toBe(
      "/api/media/assets/89350cf8-2b15/content",
    );
  });

  it("từ chối URL không an toàn hoặc đường dẫn nội bộ khác", () => {
    for (const url of ["http://example.com/a.jpg", "file:///etc/passwd", "/api/media/assets/../x/content", "/etc/passwd"]) {
      expect(() => jobWithSource(url)).toThrow("HTTPS");
    }
  });
});
