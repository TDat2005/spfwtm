import type { WatermarkMediaGateway } from "../../watermark/application/WatermarkPorts.ts";
import type { MediaService } from "../application/MediaService.ts";

export class MediaWatermarkGateway implements WatermarkMediaGateway {
  constructor(private readonly media: MediaService) {}

  async importSource(shopDomain: string, sourceUrl: string): Promise<Buffer> {
    const match = sourceUrl.match(/\/api\/media\/assets\/([a-zA-Z0-9_-]+)\/content/);
    if (match && match[1]) {
      return (await this.media.readForShop(match[1], shopDomain)).bytes;
    }
    const asset = await this.media.importRemote(shopDomain, sourceUrl);
    return (await this.media.readForShop(asset.id, shopDomain)).bytes;
  }

  async storeResult(
    shopDomain: string,
    bytes: Buffer,
    mimeType: string
  ): Promise<string> {
    return (await this.media.storeGenerated(shopDomain, bytes, mimeType)).id;
  }
}
