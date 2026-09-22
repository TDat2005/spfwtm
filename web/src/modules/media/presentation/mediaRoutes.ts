import express from "express";
import type { Request, Response } from "express";
import type { Session } from "@shopify/shopify-api";
import type { MediaService } from "../application/MediaService.ts";

interface ShopifyLocals extends Record<string, unknown> {
  shopify: { session: Session };
}

export function createMediaRouter(media: MediaService) {
  const router = express.Router();
  router.get(
    "/assets/:id/content",
    async (request: Request, response: Response<unknown, ShopifyLocals>) => {
      try {
        const id = Array.isArray(request.params.id)
          ? request.params.id[0] ?? ""
          : request.params.id ?? "";
        const result = await media.readForShop(
          id,
          response.locals.shopify.session.shop
        );
        response.set("Content-Type", result.asset.mimeType);
        response.set("Cache-Control", "private, max-age=3600");
        response.status(200).send(result.bytes);
      } catch (error: unknown) {
        console.error(
          "Media error:",
          error instanceof Error ? error.message : error
        );
        response.status(404).send({ error: "Không tìm thấy media" });
      }
    }
  );

  router.post(
    "/upload",
    async (request: Request, response: Response<unknown, ShopifyLocals>) => {
      try {
        const body = request.body as { dataUrl?: string; imageUrl?: string };
        const shopDomain = response.locals.shopify.session.shop;

        if (body.imageUrl) {
          const asset = await media.importRemote(shopDomain, body.imageUrl);
          response.status(201).send({
            assetId: asset.id,
            url: `/api/media/assets/${asset.id}/content`,
          });
          return;
        }

        if (body.dataUrl) {
          const matches = body.dataUrl.match(
            /^data:([A-Za-z-+\/]+);base64,(.+)$/
          );
          if (!matches || !matches[1] || !matches[2]) {
            throw new Error("Định dạng dataUrl không hợp lệ");
          }
          const mimeType = matches[1];
          const bytes = Buffer.from(matches[2], "base64");
          const asset = await media.storeUploaded(shopDomain, bytes, mimeType);
          response.status(201).send({
            assetId: asset.id,
            url: `/api/media/assets/${asset.id}/content`,
          });
          return;
        }

        throw new Error("Cần cung cấp dataUrl hoặc imageUrl");
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Upload thất bại";
        response.status(400).send({ error: message });
      }
    }
  );

  return router;
}
