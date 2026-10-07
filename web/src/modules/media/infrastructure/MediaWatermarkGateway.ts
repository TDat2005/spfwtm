import type { WatermarkMediaGateway } from "../../watermark/application/WatermarkPorts.ts";
import type { MediaService } from "../application/MediaService.ts";

const LOGO_CACHE_MAX_ENTRIES = 50;
const LOGO_CACHE_TTL_MS = 10 * 60 * 1000;
const LOGO_CACHE_MAX_BYTES = 5 * 1024 * 1024;

interface CachedLogo {
  bytes: Promise<Buffer>;
  expiresAt: number;
}

export class MediaWatermarkGateway implements WatermarkMediaGateway {
  /**
   * Cache theo tiến trình worker. Trước đây mỗi job tải logo từ xa và lưu
   * thành một MediaAsset mới, nên batch 10.000 sản phẩm tạo 10.000 bản sao
   * của cùng một logo. Cache giữ Promise để các job chạy song song dùng chung
   * một lần tải.
   */
  private readonly logoCache = new Map<string, CachedLogo>();

  constructor(
    private readonly media: MediaService,
    private readonly now: () => number = Date.now,
  ) {}

  async importSource(shopDomain: string, sourceUrl: string): Promise<Buffer> {
    const match = sourceUrl.match(/\/api\/media\/assets\/([a-zA-Z0-9_-]+)\/content/);
    if (match && match[1]) {
      return (await this.media.readForShop(match[1], shopDomain)).bytes;
    }
    const asset = await this.media.importRemote(shopDomain, sourceUrl);
    return (await this.media.readForShop(asset.id, shopDomain)).bytes;
  }

  async importLogo(shopDomain: string, logoUrl: string): Promise<Buffer> {
    const key = `${shopDomain}\n${logoUrl}`;
    const now = this.now();
    const cached = this.logoCache.get(key);
    if (cached && cached.expiresAt > now) {
      // Map giữ thứ tự chèn: chèn lại để mục vừa dùng thành mới nhất (LRU).
      this.logoCache.delete(key);
      this.logoCache.set(key, cached);
      return cached.bytes;
    }

    const bytes = this.importSource(shopDomain, logoUrl);
    this.logoCache.delete(key);
    this.logoCache.set(key, { bytes, expiresAt: now + LOGO_CACHE_TTL_MS });
    this.evictOldest();

    try {
      const result = await bytes;
      if (result.length > LOGO_CACHE_MAX_BYTES) this.forget(key, bytes);
      return result;
    } catch (error) {
      this.forget(key, bytes);
      throw error;
    }
  }

  async storeResult(
    shopDomain: string,
    bytes: Buffer,
    mimeType: string
  ): Promise<string> {
    return (await this.media.storeGenerated(shopDomain, bytes, mimeType)).id;
  }

  private evictOldest(): void {
    while (this.logoCache.size > LOGO_CACHE_MAX_ENTRIES) {
      const oldest = this.logoCache.keys().next().value;
      if (oldest === undefined) return;
      this.logoCache.delete(oldest);
    }
  }

  private forget(key: string, bytes: Promise<Buffer>): void {
    if (this.logoCache.get(key)?.bytes === bytes) this.logoCache.delete(key);
  }
}
