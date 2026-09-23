import sharp, { type Sharp } from "sharp";
import type { WatermarkConfiguration } from "../domain/WatermarkJob.ts";
import type { WatermarkProcessor } from "../application/WatermarkPorts.ts";

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
  const fontSize = Math.max(12, Math.round(imageWidth * configuration.fontSize));
  const padding = Math.max(10, Math.round(fontSize * 0.6));
  const overlayWidth = Math.min(
    Math.round(imageWidth * 0.92),
    Math.max(120, Math.round(configuration.text!.length * fontSize * 0.68 + padding * 2))
  );
  const overlayHeight = fontSize + padding * 2 + Math.ceil(configuration.strokeWidth * 2);
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
  const positions =
    configuration.layout === "TILED"
      ? tiledPositions(imageWidth, imageHeight, overlay, configuration)
      : [singlePosition(imageWidth, imageHeight, overlay, configuration)];
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

function singlePosition(
  imageWidth: number,
  imageHeight: number,
  overlay: PreparedOverlay,
  configuration: WatermarkConfiguration
): { left: number; top: number } {
  const margin = Math.max(8, Math.round(Math.min(imageWidth, imageHeight) * 0.02));
  const horizontal = configuration.position.endsWith("LEFT")
    ? margin
    : configuration.position.endsWith("RIGHT")
      ? imageWidth - overlay.width - margin
      : Math.round((imageWidth - overlay.width) / 2);
  const vertical = configuration.position.startsWith("TOP")
    ? margin
    : configuration.position.startsWith("BOTTOM")
      ? imageHeight - overlay.height - margin
      : Math.round((imageHeight - overlay.height) / 2);

  return {
    left: clamp(
      horizontal + Math.round(configuration.offsetX * imageWidth),
      0,
      Math.max(0, imageWidth - overlay.width)
    ),
    top: clamp(
      vertical + Math.round(configuration.offsetY * imageHeight),
      0,
      Math.max(0, imageHeight - overlay.height)
    ),
  };
}

function tiledPositions(
  imageWidth: number,
  imageHeight: number,
  overlay: PreparedOverlay,
  configuration: WatermarkConfiguration
): Array<{ left: number; top: number }> {
  const stepX = overlay.width + Math.max(Math.round(overlay.width * 0.6), Math.round(imageWidth * 0.06));
  const stepY = overlay.height + Math.max(Math.round(overlay.height * 0.8), Math.round(imageHeight * 0.06));
  const shiftX = Math.round(configuration.offsetX * imageWidth);
  const shiftY = Math.round(configuration.offsetY * imageHeight);
  const result: Array<{ left: number; top: number }> = [];

  for (let top = -stepY + shiftY; top < imageHeight; top += stepY) {
    const row = Math.floor((top - shiftY) / stepY);
    const rowShift = Math.abs(row % 2) * Math.round(stepX / 2);
    for (
      let left = -stepX + shiftX + rowShift;
      left < imageWidth;
      left += stepX
    ) {
      if (
        left + overlay.width > 0 &&
        top + overlay.height > 0 &&
        left < imageWidth &&
        top < imageHeight
      ) {
        result.push({ left: Math.max(0, left), top: Math.max(0, top) });
      }
    }
  }
  return result;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
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
