import sharp, { type OverlayOptions } from "sharp";
import type { WatermarkConfiguration } from "../domain/WatermarkJob.ts";
import type { WatermarkProcessor } from "../application/WatermarkPorts.ts";
import { overlayPlacements, textOverlayMetrics } from "../domain/WatermarkGeometry.ts";

interface PreparedOverlay {
  bytes: Buffer;
  width: number;
  height: number;
}

/**
 * Mỗi job Sharp tự dùng thread pool của libvips (mặc định = số nhân CPU). Khi
 * worker chạy nhiều job song song nên giới hạn lại để tổng số thread
 * (concurrency của lane x SHARP_CONCURRENCY) không vượt quá số nhân CPU.
 */
export function configureSharpConcurrency(value: string | undefined): void {
  if (value === undefined || value.trim() === "") return;
  const threads = Number(value);
  if (!Number.isInteger(threads) || threads <= 0) {
    throw new Error("SHARP_CONCURRENCY phải là số nguyên lớn hơn 0");
  }
  sharp.concurrency(threads);
}

export class SharpWatermarkProcessor implements WatermarkProcessor {
  async render(input: Parameters<WatermarkProcessor["render"]>[0]) {
    const image = sharp(input.source, { failOn: "error" }).rotate();
    const metadata = await image.metadata();
    const width = metadata.width ?? 1200;
    const height = metadata.height ?? 1200;

    // Mọi lớp được ghép trong một lần composite: ảnh chỉ decode/encode một lần
    // dù có 7 lớp. Thứ tự mảng = thứ tự chồng lớp (lớp đầu nằm dưới cùng).
    const composites: OverlayOptions[] = [];
    for (const [index, layer] of input.design.activeLayers.entries()) {
      const overlay = await prepareLayerOverlay(layer, input.logos, width, index);
      for (const { left, top } of overlayPlacements(layer.layout, width, height, overlay, layer)) {
        composites.push({ input: overlay.bytes, left, top });
      }
    }

    const bytes = await image.composite(composites).webp({ quality: 90 }).toBuffer();
    return { bytes, mimeType: "image/webp" };
  }
}

async function prepareLayerOverlay(
  layer: WatermarkConfiguration,
  logos: ReadonlyMap<string, Buffer>,
  imageWidth: number,
  index: number
): Promise<PreparedOverlay> {
  if (layer.type === "TEXT") {
    if (!layer.text) throw new Error(`Lớp ${index + 1}: thiếu nội dung chữ`);
    return prepareTextOverlay(layer, imageWidth);
  }
  const logo = layer.logoUrl ? logos.get(layer.logoUrl) : undefined;
  if (!logo) throw new Error(`Lớp ${index + 1}: chưa tải được logo`);
  return prepareLogoOverlay(logo, layer, imageWidth);
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
