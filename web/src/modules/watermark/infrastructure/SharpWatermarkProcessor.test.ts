import { crc32, deflateSync } from "node:zlib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { WatermarkDesign } from "../domain/WatermarkDesign.ts";
import { SharpWatermarkProcessor } from "./SharpWatermarkProcessor.ts";

const WIDTH = 400;
const HEIGHT = 300;

async function solid(width: number, height: number, color: { r: number; g: number; b: number }) {
  return sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
}

async function pixel(image: Buffer, left: number, top: number) {
  const { data } = await sharp(image)
    .extract({ left, top, width: 1, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return [data[0], data[1], data[2]];
}

describe("SharpWatermarkProcessor", () => {
  it("ghép 7 lớp chữ + logo vào một ảnh WebP cùng kích thước", async () => {
    const source = await solid(WIDTH, HEIGHT, { r: 255, g: 255, b: 255 });
    const red = await solid(60, 60, { r: 255, g: 0, b: 0 });
    const blue = await solid(60, 60, { r: 0, g: 0, b: 255 });
    const design = new WatermarkDesign([
      { type: "TEXT", text: "© Shop", position: "CENTER", opacity: 0.2, layout: "TILED", rotation: -30 },
      { type: "TEXT", text: "SALE", position: "TOP_CENTER", opacity: 1, textColor: "#00AA00" },
      { type: "TEXT", text: "Chính hãng", position: "BOTTOM_CENTER", opacity: 1 },
      { type: "IMAGE", logoUrl: "https://cdn.example.com/red.png", position: "TOP_LEFT", opacity: 1, logoScale: 0.15 },
      { type: "IMAGE", logoUrl: "https://cdn.example.com/blue.png", position: "BOTTOM_RIGHT", opacity: 1, logoScale: 0.15 },
      { type: "IMAGE", logoUrl: "https://cdn.example.com/red.png", position: "MIDDLE_RIGHT", opacity: 1, logoScale: 0.1 },
      { type: "TEXT", text: "#1", position: "MIDDLE_LEFT", opacity: 1 },
    ]);

    const result = await new SharpWatermarkProcessor().render({
      source,
      design,
      logos: new Map([
        ["https://cdn.example.com/red.png", red],
        ["https://cdn.example.com/blue.png", blue],
      ]),
    });

    expect(result.mimeType).toBe("image/webp");
    const metadata = await sharp(result.bytes).metadata();
    expect([metadata.width, metadata.height]).toEqual([WIDTH, HEIGHT]);

    // Logo đỏ ở góc trên trái, logo xanh ở góc dưới phải (margin 8px, rộng 60px).
    const [r1, g1, b1] = await pixel(result.bytes, 20, 20);
    expect(r1).toBeGreaterThan(200);
    expect(g1).toBeLessThan(60);
    expect(b1).toBeLessThan(60);
    const [r2, , b2] = await pixel(result.bytes, WIDTH - 20, HEIGHT - 20);
    expect(b2).toBeGreaterThan(200);
    expect(r2).toBeLessThan(60);
  });

  it("lớp sau chồng lên lớp trước", async () => {
    const source = await solid(WIDTH, HEIGHT, { r: 255, g: 255, b: 255 });
    const red = await solid(60, 60, { r: 255, g: 0, b: 0 });
    const blue = await solid(60, 60, { r: 0, g: 0, b: 255 });
    const logos = new Map([
      ["https://cdn.example.com/red.png", red],
      ["https://cdn.example.com/blue.png", blue],
    ]);
    const layer = (url: string) => ({
      type: "IMAGE" as const,
      logoUrl: url,
      position: "CENTER" as const,
      opacity: 1,
      logoScale: 0.15,
    });

    const redOnTop = await new SharpWatermarkProcessor().render({
      source,
      logos,
      design: new WatermarkDesign([layer("https://cdn.example.com/blue.png"), layer("https://cdn.example.com/red.png")]),
    });

    const [r, , b] = await pixel(redOnTop.bytes, WIDTH / 2, HEIGHT / 2);
    expect(r).toBeGreaterThan(200);
    expect(b).toBeLessThan(60);
  });

  it("báo lỗi rõ lớp nào thiếu logo", async () => {
    const source = await solid(WIDTH, HEIGHT, { r: 255, g: 255, b: 255 });
    await expect(
      new SharpWatermarkProcessor().render({
        source,
        logos: new Map(),
        design: new WatermarkDesign([
          { type: "TEXT", text: "A", position: "CENTER", opacity: 1 },
          { type: "IMAGE", logoUrl: "https://cdn.example.com/x.png", position: "CENTER", opacity: 1 },
        ]),
      }),
    ).rejects.toThrow("Lớp 2: chưa tải được logo");
  });

  it("từ chối ảnh quá nhiều pixel trước khi decode, để không làm worker hết RAM", async () => {
    const design = new WatermarkDesign([
      { type: "TEXT", text: "© Shop", position: "CENTER", opacity: 1 },
    ]);

    await expect(
      new SharpWatermarkProcessor().render({
        source: pngHeader(10_000, 10_000),
        design,
        logos: new Map(),
      }),
    ).rejects.toThrow("Ảnh nguồn quá lớn (tối đa 50 megapixel)");
  });
});

/** PNG chỉ có header khai báo kích thước: đủ để Sharp đọc metadata mà không cần 100 MP dữ liệu. */
function pngHeader(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.alloc(0))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
