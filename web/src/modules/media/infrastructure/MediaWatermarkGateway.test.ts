import { describe, expect, it, vi } from "vitest";
import type { MediaService } from "../application/MediaService.ts";
import { MediaWatermarkGateway } from "./MediaWatermarkGateway.ts";

function setup() {
  let now = 0;
  const importRemote = vi.fn(async (_shop: string, url: string) => ({ id: `asset-${url}` }));
  const readForShop = vi.fn(async (id: string) => ({ bytes: Buffer.from(id) }));
  const gateway = new MediaWatermarkGateway(
    { importRemote, readForShop } as unknown as MediaService,
    () => now,
  );
  return { gateway, importRemote, advance: (ms: number) => (now += ms) };
}

describe("MediaWatermarkGateway.importLogo", () => {
  it("tải và lưu logo một lần cho mọi job dùng chung, kể cả khi chạy song song", async () => {
    const { gateway, importRemote } = setup();
    const url = "https://cdn.example.com/logo.png";

    const results = await Promise.all(
      Array.from({ length: 20 }, () => gateway.importLogo("a.myshopify.com", url)),
    );

    expect(importRemote).toHaveBeenCalledTimes(1);
    expect(new Set(results.map((bytes) => bytes.toString())).size).toBe(1);
  });

  it("tách cache theo shop và hết hạn sau 10 phút", async () => {
    const { gateway, importRemote, advance } = setup();
    const url = "https://cdn.example.com/logo.png";

    await gateway.importLogo("a.myshopify.com", url);
    await gateway.importLogo("b.myshopify.com", url);
    expect(importRemote).toHaveBeenCalledTimes(2);

    advance(10 * 60 * 1000 + 1);
    await gateway.importLogo("a.myshopify.com", url);
    expect(importRemote).toHaveBeenCalledTimes(3);
  });

  it("không cache lần tải lỗi", async () => {
    const { gateway, importRemote } = setup();
    importRemote.mockRejectedValueOnce(new Error("timeout"));
    const url = "https://cdn.example.com/logo.png";

    await expect(gateway.importLogo("a.myshopify.com", url)).rejects.toThrow("timeout");
    await expect(gateway.importLogo("a.myshopify.com", url)).resolves.toBeInstanceOf(Buffer);
    expect(importRemote).toHaveBeenCalledTimes(2);
  });
});
