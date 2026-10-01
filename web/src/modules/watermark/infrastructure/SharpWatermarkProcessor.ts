import sharp, { type Sharp } from "sharp";
import type { WatermarkConfiguration } from "../domain/WatermarkJob.ts";
import type { WatermarkProcessor } from "../application/WatermarkPorts.ts";
import {
  overlayPlacements,
  textOverlayMetrics,
} from "../domain/WatermarkGeometry.ts";

interface PreparedOverlay {
  bytes: Buffer;
  width: number;
  height: number;
}

export class SharpWatermarkProcessor implements WatermarkProcessor {
  async applyText(input: Parameters<WatermarkProcessor["applyText"]>[0]) {
    const configuration = input.configuration;
    if (configuration.type !== "TEXT" || !configuration.text) {
      throw new Error("Cấu hình watermark chữ không hợp lệ");
    }

    const image = sharp(input.source, { failOn: "error" }).rotate();
    const metadata = await image.metadata();
    const width = metadata.width ?? 1200;
    const height = metadata.height ?? 1200;
    const overlay = await prepareTextOverlay(configuration, width);
    return render(image, width, height, overlay, configuration);
  }

  async applyImage(input: Parameters<WatermarkProcessor["applyImage"]>[0]) {
    const configuration = input.configuration;
    if (configuration.type !== "IMAGE") {
      throw new Error("Cấu hình watermark logo không hợp lệ");
    }

    const image = sharp(input.source, { failOn: "error" }).rotate();
    const metadata = await image.metadata();
    const width = metadata.width ?? 1200;
    const height = metadata.height ?? 1200;
    const overlay = await prepareLogoOverlay(input.logo, configuration, width);
    return render(image, width, height, overlay, configuration);
  }
}

async function prepareTextOverlay(
  configuration: WatermarkConfiguration,
  imageWidth: number
): Promise<PreparedOverlay> {
  const { fontSize, width: overlayWidth, height: overlayHeight } =
    textOverlayMetrics(
      configuration.text!,
      configuration.fontSize,
      configuration.strokeWidth,
      imageWidth
    );
  const svg = Buffer.from(
    `<svg width="${overlayWidth}" height="${overlayHeight}" xmlns="http://www.w3.org/2000/svg">` +
      `<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" ` +
      `font-family="${escapeXml(configuration.fontFamily)}, sans-serif" font-size="${fontSize}" ` +
      `font-weight="700" fill="${configuration.textColor}" fill-opacity="${configuration.opacity}" ` +
      `stroke="${configuration.strokeColor}" stroke-opacity="${configuration.opacity}" ` +
      `stroke-width="${configuration.strokeWidth}">${escapeXml(configuration.text!)}</text></svg>`
  );

  return rotateOverlay(svg, configuration.rotation);
}

async function prepareLogoOverlay(
  logo: Buffer,
  configuration: WatermarkConfiguration,
  imageWidth: number
): Promise<PreparedOverlay> {
  const targetLogoWidth = Math.max(32, Math.round(imageWidth * configuration.logoScale));
  const alpha = Math.round(configuration.opacity * 255);
  const prepared = await sharp(logo, { failOn: "error" })
    .resize({ width: targetLogoWidth, fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .composite([
      {
        input: Buffer.from([255, 255, 255, alpha]),
        raw: { width: 1, height: 1, channels: 4 },
        tile: true,
        blend: "dest-in",
      },
    ])
    .png()
    .toBuffer();
  return rotateOverlay(prepared, configuration.rotation);
}

async function rotateOverlay(
  input: Buffer,
  rotation: number
): Promise<PreparedOverlay> {
  const result = await sharp(input)
    .rotate(rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer({ resolveWithObject: true });
  return {
    bytes: result.data,
    width: result.info.width,
    height: result.info.height,
  };
}

async function render(
  image: Sharp,
  imageWidth: number,
  imageHeight: number,
  overlay: PreparedOverlay,
  configuration: WatermarkConfiguration
) {
  const positions = overlayPlacements(
    configuration.layout,
    imageWidth,
    imageHeight,
    overlay,
    configuration
  );
  const bytes = await image
    .composite(
      positions.map(({ left, top }) => ({
        input: overlay.bytes,
        left,
        top,
      }))
    )
    .webp({ quality: 90 })
    .toBuffer();
  return { bytes, mimeType: "image/webp" };
}

function escapeXml(value: string): string {
  return value.replace(
    /[<>&'\"]/g,
    (character) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        "'": "&apos;",
        '"': "&quot;",
      })[character] ?? character
  );
}
