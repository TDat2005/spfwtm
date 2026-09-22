import type { RemoteImageDownloader } from "../application/MediaPorts.ts";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export class FetchRemoteImageDownloader implements RemoteImageDownloader {
  async download(value: string) {
    const url = new URL(value);
    if (url.protocol !== "https:")
      throw new Error("Chỉ cho phép tải ảnh qua HTTPS");

    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      throw new Error(`Không tải được ảnh nguồn: HTTP ${response.status}`);

    const mimeType =
      response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    if (!mimeType.startsWith("image/"))
      throw new Error("URL nguồn không trả về hình ảnh");

    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_IMAGE_BYTES)
      throw new Error("Ảnh nguồn vượt quá giới hạn 20 MB");

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0) throw new Error("Ảnh nguồn rỗng");
    if (bytes.length > MAX_IMAGE_BYTES)
      throw new Error("Ảnh nguồn vượt quá giới hạn 20 MB");
    return { bytes, mimeType };
  }
}
