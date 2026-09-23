import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { WatermarkConfiguration } from "../domain/WatermarkJob.ts";
import { SharpWatermarkProcessor } from "./SharpWatermarkProcessor.ts";

describe("SharpWatermarkProcessor", () => {
  it("render watermark chữ bằng đúng cấu hình domain", async () => {
    const source = await sharp({
      create: {
        width: 320,
        height: 240,
        channels: 3,
        background: "#2457A6",
      },
    })
      .png()
      .toBuffer();
    const configuration = new WatermarkConfiguration({
      type: "TEXT",
      text: "© Demo",
      position: "BOTTOM_CENTER",
      opacity: 0.8,
      rotation: -15,
      textColor: "#FFFFFF",
      strokeColor: "#000000",
    });

    const result = await new SharpWatermarkProcessor().applyText({
      source,
      configuration,
    });
    const metadata = await sharp(result.bytes).metadata();

    expect(result.mimeType).toBe("image/webp");
    expect(metadata.width).toBe(320);
    expect(metadata.height).toBe(240);
  });

  it("render logo dạng tiled", async () => {
    const source = await sharp({
      create: {
        width: 320,
        height: 240,
        channels: 3,
        background: "#FFFFFF",
      },
    })
      .png()
      .toBuffer();
    const logo = await sharp({
      create: {
        width: 40,
        height: 40,
        channels: 4,
        background: "#CC0000",
      },
    })
      .png()
      .toBuffer();
    const configuration = new WatermarkConfiguration({
      type: "IMAGE",
      logoUrl: "/api/media/assets/logo-1/content",
      logoScale: 0.15,
      position: "CENTER",
      opacity: 0.5,
      layout: "TILED",
      rotation: 30,
    });

    const result = await new SharpWatermarkProcessor().applyImage({
      source,
      logo,
      configuration,
    });
    expect((await sharp(result.bytes).metadata()).format).toBe("webp");
  });
});
