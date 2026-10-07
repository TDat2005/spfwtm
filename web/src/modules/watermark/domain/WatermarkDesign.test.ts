import { describe, expect, it } from "vitest";
import {
  MAX_WATERMARK_LAYERS,
  WatermarkDesign,
  type WatermarkLayerProps,
} from "./WatermarkDesign.ts";

const text = (value: string, extra: Partial<WatermarkLayerProps> = {}): WatermarkLayerProps => ({
  type: "TEXT",
  text: value,
  position: "BOTTOM_RIGHT",
  opacity: 0.7,
  ...extra,
});
const logo = (url: string, extra: Partial<WatermarkLayerProps> = {}): WatermarkLayerProps => ({
  type: "IMAGE",
  logoUrl: url,
  position: "TOP_LEFT",
  opacity: 0.5,
  ...extra,
});

describe("WatermarkDesign", () => {
  it("giữ thứ tự lớp và chỉ render lớp đang bật", () => {
    const design = new WatermarkDesign([
      text("Dưới cùng"),
      text("Bị ẩn", { enabled: false }),
      logo("https://cdn.example.com/logo.png"),
    ]);

    expect(design.layers).toHaveLength(3);
    expect(design.activeLayers.map((layer) => layer.text ?? layer.logoUrl)).toEqual([
      "Dưới cùng",
      "https://cdn.example.com/logo.png",
    ]);
    expect(design.summary).toBe('"Dưới cùng" + Logo');
  });

  it("hỗ trợ 7 lớp và tải mỗi logo một lần dù nhiều lớp dùng chung", () => {
    const shared = "https://cdn.example.com/logo.png";
    const design = new WatermarkDesign([
      text("© Shop", { layout: "TILED", opacity: 0.15, rotation: -30 }),
      text("SALE", { position: "TOP_CENTER" }),
      text("Hàng chính hãng", { position: "BOTTOM_CENTER" }),
      logo(shared),
      logo(shared, { position: "BOTTOM_LEFT" }),
      logo("https://cdn.example.com/badge.png", { position: "TOP_RIGHT" }),
      text("#1", { position: "CENTER", fontSize: 0.1 }),
    ]);

    expect(design.activeLayers).toHaveLength(7);
    expect(design.logoUrls).toEqual([shared, "https://cdn.example.com/badge.png"]);
  });

  it("áp giới hạn số lớp, số logo và số lớp tiled", () => {
    expect(() => new WatermarkDesign([])).toThrow("ít nhất một lớp");
    expect(
      () => new WatermarkDesign(Array.from({ length: MAX_WATERMARK_LAYERS + 1 }, (_, i) => text(`L${i}`)))
    ).toThrow(`tối đa ${MAX_WATERMARK_LAYERS} lớp`);
    expect(
      () => new WatermarkDesign([1, 2, 3, 4].map((i) => logo(`https://cdn.example.com/${i}.png`)))
    ).toThrow("Tối đa 3 lớp logo");
    expect(
      () => new WatermarkDesign([1, 2, 3, 4].map((i) => text(`T${i}`, { layout: "TILED" })))
    ).toThrow("Tối đa 3 lớp lặp");
    expect(() => new WatermarkDesign([text("Ẩn", { enabled: false })])).toThrow(
      "Cần bật ít nhất một lớp"
    );
  });

  it("lớp ẩn không tính vào giới hạn logo", () => {
    const layers = [1, 2, 3, 4].map((i) =>
      logo(`https://cdn.example.com/${i}.png`, { enabled: i < 4 })
    );
    expect(new WatermarkDesign(layers).logoUrls).toHaveLength(3);
  });

  it("báo lỗi kèm số thứ tự lớp", () => {
    expect(() => new WatermarkDesign([text("OK"), text("")])).toThrow(
      "Lớp 2: Nội dung watermark không được để trống"
    );
    expect(() =>
      new WatermarkDesign([text("OK", { position: "SOMEWHERE" as never })])
    ).toThrow("Lớp 1: Vị trí watermark không hợp lệ");
  });

  it("đọc lại đúng design đã lưu", () => {
    const design = new WatermarkDesign([text("A"), logo("https://cdn.example.com/l.png")]);
    const restored = WatermarkDesign.fromJSON(JSON.stringify(design.toJSON()));
    expect(restored.toJSON()).toEqual(design.toJSON());
  });

  it("đọc template v1 (cấu hình phẳng dùng watermarkType) thành design một lớp", () => {
    const design = WatermarkDesign.fromJSON({
      watermarkType: "IMAGE",
      text: "",
      logoUrl: "/api/media/assets/abc/content",
      position: "CENTER",
      opacity: 0.4,
      layout: "SINGLE",
    });

    expect(design.toJSON()).toMatchObject({
      version: 2,
      layers: [{ enabled: true, type: "IMAGE", logoUrl: "/api/media/assets/abc/content", opacity: 0.4 }],
    });
  });
});
