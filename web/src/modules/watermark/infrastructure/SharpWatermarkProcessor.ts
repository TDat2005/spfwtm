import sharp from "sharp";
import type { WatermarkProcessor } from "../application/WatermarkPorts.ts";

const gravity = {
  TOP_LEFT: "northwest",
  TOP_RIGHT: "northeast",
  CENTER: "centre",
  BOTTOM_LEFT: "southwest",
  BOTTOM_RIGHT: "southeast",
} as const;

export class SharpWatermarkProcessor implements WatermarkProcessor {
  async applyText(input: Parameters<WatermarkProcessor["applyText"]>[0]) {
    const image = sharp(input.source, { failOn: "error" }).rotate();
    const metadata = await image.metadata();
    const width = metadata.width ?? 1200;
    const fontSize = Math.max(18, Math.round(width * 0.045));
    const padding = Math.max(12, Math.round(fontSize * 0.6));
    const text = escapeXml(input.text);
    const overlayWidth = Math.min(
      width,
      Math.max(200, Math.round(text.length * fontSize * 0.7 + padding * 2))
    );
    const overlayHeight = fontSize + padding * 2;
    const alpha = Math.round(input.opacity * 255)
      .toString(16)
      .padStart(2, "0");
    const svg = Buffer.from(
      `<svg width="${overlayWidth}" height="${overlayHeight}" xmlns="http://www.w3.org/2000/svg"><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="#ffffff${alpha}" stroke="#000000${alpha}" stroke-width="2">${text}</text></svg>`
    );

    const bytes = await image
      .composite([{ input: svg, gravity: gravity[input.position] }])
      .webp({ quality: 90 })
      .toBuffer();
    return { bytes, mimeType: "image/webp" };
  }

  async applyImage(input: Parameters<WatermarkProcessor["applyImage"]>[0]) {
    const image = sharp(input.source, { failOn: "error" }).rotate();
    const metadata = await image.metadata();
    const width = metadata.width ?? 1200;
    const targetLogoWidth = Math.max(
      40,
      Math.round(width * Math.min(Math.max(input.scale, 0.05), 1))
    );

    const alpha = Math.round(input.opacity * 255);
    const resizedLogo = await sharp(input.logo)
      .resize({ width: targetLogoWidth, fit: "inside" })
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

    const bytes = await image
      .composite([{ input: resizedLogo, gravity: gravity[input.position] }])
      .webp({ quality: 90 })
      .toBuffer();

    return { bytes, mimeType: "image/webp" };
  }
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
      }[character] ?? character)
  );
}
