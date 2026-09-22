import { randomUUID } from "node:crypto";
import { extname } from "node:path";

import { MediaAsset, type MediaAssetKind } from "../domain/MediaAsset.ts";
import type {
  ContentHasher,
  MediaAssetRepository,
  MediaStorage,
  RemoteImageDownloader,
} from "./MediaPorts.ts";

interface StoreInput {
  shopDomain: string;
  kind: MediaAssetKind;
  bytes: Buffer;
  mimeType: string;
  sourceUrl?: string | null;
}

export class MediaService {
  constructor(
    private readonly downloader: RemoteImageDownloader,
    private readonly storage: MediaStorage,
    private readonly hasher: ContentHasher,
    private readonly repository: MediaAssetRepository
  ) {}

  async importRemote(
    shopDomain: string,
    sourceUrl: string
  ): Promise<MediaAsset> {
    const downloaded = await this.downloader.download(sourceUrl);
    return this.store({ shopDomain, kind: "SOURCE", sourceUrl, ...downloaded });
  }

  async storeGenerated(
    shopDomain: string,
    bytes: Buffer,
    mimeType: string
  ): Promise<MediaAsset> {
    return this.store({ shopDomain, kind: "PROCESSED", bytes, mimeType });
  }

  async storeUploaded(
    shopDomain: string,
    bytes: Buffer,
    mimeType: string
  ): Promise<MediaAsset> {
    return this.store({ shopDomain, kind: "SOURCE", bytes, mimeType });
  }

  async readForShop(
    assetId: string,
    shopDomain: string
  ): Promise<{ asset: MediaAsset; bytes: Buffer }> {
    const asset = await this.repository.findByIdForShop(assetId, shopDomain);
    if (!asset) throw new Error("Không tìm thấy media");
    return { asset, bytes: await this.storage.read(asset.storageKey) };
  }

  private async store(input: StoreInput): Promise<MediaAsset> {
    if (!input.shopDomain.trim())
      throw new Error("Shop domain không được để trống");
    if (!input.mimeType.startsWith("image/"))
      throw new Error("Media phải là hình ảnh");

    const id = randomUUID();
    const extension = extensionFor(input.mimeType, input.sourceUrl);
    const storageKey = `${safeShop(
      input.shopDomain
    )}/${input.kind.toLowerCase()}/${id}${extension}`;
    const asset = new MediaAsset({
      id,
      shopDomain: input.shopDomain,
      kind: input.kind,
      storageKey,
      sourceUrl: input.sourceUrl ?? null,
      mimeType: input.mimeType,
      contentHash: this.hasher.hash(input.bytes),
      byteSize: input.bytes.length,
    });

    await this.storage.save(storageKey, input.bytes);
    await this.repository.save(asset);
    return asset;
  }
}

function safeShop(shopDomain: string): string {
  return shopDomain.toLowerCase().replace(/[^a-z0-9.-]/g, "_");
}

function extensionFor(mimeType: string, sourceUrl?: string | null): string {
  const byMime: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
  };
  if (byMime[mimeType]) return byMime[mimeType];
  if (sourceUrl) {
    try {
      const extension = extname(new URL(sourceUrl).pathname).toLowerCase();
      if (/^\.[a-z0-9]{2,5}$/.test(extension)) return extension;
    } catch {}
  }
  return ".img";
}
