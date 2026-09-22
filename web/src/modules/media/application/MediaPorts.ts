import type { MediaAsset } from "../domain/MediaAsset.ts";

export interface DownloadedImage {
  bytes: Buffer;
  mimeType: string;
}

export interface RemoteImageDownloader {
  download(url: string): Promise<DownloadedImage>;
}

export interface MediaStorage {
  save(storageKey: string, bytes: Buffer): Promise<void>;
  read(storageKey: string): Promise<Buffer>;
}

export interface ContentHasher {
  hash(bytes: Buffer): string;
}

export interface MediaAssetRepository {
  save(asset: MediaAsset): Promise<void>;
  findByIdForShop(id: string, shopDomain: string): Promise<MediaAsset | null>;
}
