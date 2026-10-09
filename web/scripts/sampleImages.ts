import sharp from "sharp";

/** Ảnh nền màu khác nhau, có số to ở giữa để dễ nhận ra trên kết quả watermark. */
export async function sampleImage(index: number, total: number, size: number): Promise<Buffer> {
  const hue = Math.round((index * 360) / total);
  const svg = Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="hsl(${hue},70%,75%)"/>` +
      `<stop offset="1" stop-color="hsl(${(hue + 40) % 360},70%,45%)"/>` +
      `</linearGradient></defs>` +
      `<rect width="100%" height="100%" fill="url(#g)"/>` +
      `<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" ` +
      `font-family="Arial, sans-serif" font-weight="700" font-size="${Math.round(size / 4)}" ` +
      `fill="#ffffff" fill-opacity="0.85">${index + 1}</text></svg>`,
  );
  return sharp(svg).jpeg({ quality: 85 }).toBuffer();
}

export function positiveInteger(value: string | undefined, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} phải là số nguyên lớn hơn 0`);
  return parsed;
}

/** Product type cho sản phẩm thứ `index`: mỗi nhóm `perType` sản phẩm một loại (một batch tối đa 5.000). */
export function productTypeFor(index: number, count: number, perType: number, prefix: string): string {
  return count <= perType ? prefix : `${prefix} ${Math.floor(index / perType) + 1}`;
}
