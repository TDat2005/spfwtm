import { Body, Controller, Get, Inject, Param, Post, Res } from "@nestjs/common";
import { APP_DEPENDENCIES, type AppDependencies } from "../../../app/AppDependencies.ts";
import { routeError, type ShopifyResponse } from "../../../app/ShopifyResponse.ts";
import type { PublishedMedia } from "../domain/PublishedMedia.ts";

@Controller("api/publications")
export class PublicationController {
  constructor(@Inject(APP_DEPENDENCIES) private readonly dependencies: AppDependencies) {}

  @Get()
  async list(@Res() response: ShopifyResponse): Promise<void> {
    try {
      const publications = await this.dependencies.listPublishedMedia.execute(
        response.locals.shopify.session.shop,
      );
      response.status(200).send({ publications: publications.map(toResponse) });
    } catch (error) {
      routeError(response, "Publication", error);
    }
  }

  @Post("jobs/:jobId")
  async publish(
    @Param("jobId") jobId: string,
    @Body() body: { altText?: unknown },
    @Res() response: ShopifyResponse,
  ): Promise<void> {
    try {
      const session = response.locals.shopify.session;
      const publishedMedia = await this.dependencies.createPublishWatermarkedImage(session).execute({
        watermarkJobId: jobId,
        shopDomain: session.shop,
        altText: String(body.altText ?? "Product image with watermark"),
      });
      response.status(201).send({ publishedMedia: toResponse(publishedMedia) });
    } catch (error) {
      routeError(response, "Publication", error);
    }
  }

  @Post("jobs/:jobId/restore")
  async restore(@Param("jobId") jobId: string, @Res() response: ShopifyResponse): Promise<void> {
    try {
      const session = response.locals.shopify.session;
      const result = await this.dependencies.createRestoreOriginalImage(session).execute({
        watermarkJobId: jobId,
        shopDomain: session.shop,
      });
      response.status(200).send({ success: true, result });
    } catch (error) {
      routeError(response, "Publication", error);
    }
  }
}

function toResponse(media: PublishedMedia) {
  return {
    id: media.id,
    watermarkJobId: media.watermarkJobId,
    productId: media.productId,
    shopifyMediaId: media.shopifyMediaId,
    imageUrl: media.imageUrl,
    createdAt: media.createdAt,
  };
}
