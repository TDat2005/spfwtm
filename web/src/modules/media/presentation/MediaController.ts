import { Body, Controller, Get, Inject, Param, Post, Res } from "@nestjs/common";
import { APP_DEPENDENCIES, type AppDependencies } from "../../../app/AppDependencies.ts";
import { routeError, type ShopifyResponse } from "../../../app/ShopifyResponse.ts";

@Controller("api/media")
export class MediaController {
  constructor(@Inject(APP_DEPENDENCIES) private readonly dependencies: AppDependencies) {}

  @Get("assets/:id/content")
  async content(@Param("id") id: string, @Res() response: ShopifyResponse): Promise<void> {
    try {
      const result = await this.dependencies.mediaService.readForShop(
        id,
        response.locals.shopify.session.shop,
      );
      response.set("Content-Type", result.asset.mimeType);
      response.set("Cache-Control", "private, max-age=3600");
      response.status(200).send(result.bytes);
    } catch (error) {
      routeError(response, "Media", error, 404, "Không tìm thấy media");
    }
  }

  @Post("upload")
  async upload(
    @Body() body: { dataUrl?: string; imageUrl?: string },
    @Res() response: ShopifyResponse,
  ): Promise<void> {
    try {
      const shopDomain = response.locals.shopify.session.shop;
      if (body.imageUrl) {
        const asset = await this.dependencies.mediaService.importRemote(shopDomain, body.imageUrl);
        response.status(201).send({ assetId: asset.id, url: `/api/media/assets/${asset.id}/content` });
        return;
      }
      if (body.dataUrl) {
        const matches = body.dataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (!matches?.[1] || !matches[2]) throw new Error("Định dạng dataUrl không hợp lệ");
        const bytes = Buffer.from(matches[2], "base64");
        const asset = await this.dependencies.mediaService.storeUploaded(shopDomain, bytes, matches[1]);
        response.status(201).send({ assetId: asset.id, url: `/api/media/assets/${asset.id}/content` });
        return;
      }
      throw new Error("Cần cung cấp dataUrl hoặc imageUrl");
    } catch (error) {
      routeError(response, "Media", error, 400);
    }
  }
}
