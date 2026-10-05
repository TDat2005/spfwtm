import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Optional,
  Param,
  Post,
  Res,
  StreamableFile,
} from "@nestjs/common";
import type { Session } from "@shopify/shopify-api";
import type { Response } from "express";
import { ShopifySession } from "../../../shared/nest/ShopifySession.ts";
import { toHttpException } from "../../../shared/nest/toHttpException.ts";
import { MediaService } from "../application/MediaService.ts";
import { StorageCleanupService } from "../application/StorageCleanupService.ts";

@Controller("api/media")
export class MediaController {
  constructor(
    @Inject(MediaService) private readonly mediaService: MediaService,
    @Optional() @Inject(StorageCleanupService) private readonly cleanupService?: StorageCleanupService,
  ) {}

  @Post("cleanup")
  @HttpCode(HttpStatus.OK)
  async cleanup(
    @Body("olderThanDays") olderThanDays: unknown,
    @ShopifySession() session: Session,
  ) {
    try {
      if (!this.cleanupService) {
        return { success: true, deletedAssetsCount: 0, freedBytes: 0 };
      }
      const days = typeof olderThanDays === "number" ? olderThanDays : 7;
      const result = await this.cleanupService.cleanupProcessedAssets({
        shopDomain: session.shop,
        olderThanDays: days,
      });
      return { success: true, ...result };
    } catch (error) {
      throw toHttpException("Media", error);
    }
  }

  @Get("assets/:id/content")
  async content(
    @Param("id") id: string,
    @ShopifySession() session: Session,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    try {
      const result = await this.mediaService.readForShop(id, session.shop);
      response.set("Cache-Control", "private, max-age=3600");
      return new StreamableFile(result.bytes, { type: result.asset.mimeType });
    } catch (error) {
      throw toHttpException("Media", error, HttpStatus.NOT_FOUND, "Không tìm thấy media");
    }
  }

  @Post("upload")
  async upload(
    @Body() body: { dataUrl?: string; imageUrl?: string },
    @ShopifySession() session: Session,
  ) {
    try {
      const asset = await this.store(session.shop, body);
      return { assetId: asset.id, url: `/api/media/assets/${asset.id}/content` };
    } catch (error) {
      throw toHttpException("Media", error, HttpStatus.BAD_REQUEST);
    }
  }

  private async store(shopDomain: string, body: { dataUrl?: string; imageUrl?: string }) {
    if (body.imageUrl) {
      return await this.mediaService.importRemote(shopDomain, body.imageUrl);
    }
    if (body.dataUrl) {
      const matches = body.dataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (!matches?.[1] || !matches[2]) {
        throw new BadRequestException({ error: "Định dạng dataUrl không hợp lệ" });
      }
      const bytes = Buffer.from(matches[2], "base64");
      return await this.mediaService.storeUploaded(shopDomain, bytes, matches[1]);
    }
    throw new BadRequestException({ error: "Cần cung cấp dataUrl hoặc imageUrl" });
  }
}
