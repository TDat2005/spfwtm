import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post } from "@nestjs/common";
import type { Session } from "@shopify/shopify-api";
import { ShopifySession } from "../../../shared/nest/ShopifySession.ts";
import { toHttpException } from "../../../shared/nest/toHttpException.ts";
import { ListPublishedMedia } from "../application/ListPublishedMedia.ts";
import type { PublishedMedia } from "../domain/PublishedMedia.ts";
import { PublicationUseCaseFactory } from "../infrastructure/PublicationUseCaseFactory.ts";

@Controller("api/publications")
export class PublicationController {
  constructor(
    @Inject(ListPublishedMedia) private readonly listPublishedMedia: ListPublishedMedia,
    @Inject(PublicationUseCaseFactory) private readonly useCases: PublicationUseCaseFactory,
  ) {}

  @Get()
  async list(@ShopifySession() session: Session) {
    try {
      const publications = await this.listPublishedMedia.execute(session.shop);
      return { publications: publications.map(toResponse) };
    } catch (error) {
      throw toHttpException("Publication", error);
    }
  }

  @Post("jobs/:jobId")
  async publish(
    @Param("jobId") jobId: string,
    @Body("altText") altText: unknown,
    @ShopifySession() session: Session,
  ) {
    try {
      const publishedMedia = await this.useCases.publishWatermarkedImage(session).execute({
        watermarkJobId: jobId,
        shopDomain: session.shop,
        altText: String(altText ?? "Product image with watermark"),
      });
      return { publishedMedia: toResponse(publishedMedia) };
    } catch (error) {
      throw toHttpException("Publication", error);
    }
  }

  @Post("jobs/:jobId/restore")
  @HttpCode(HttpStatus.OK)
  async restore(@Param("jobId") jobId: string, @ShopifySession() session: Session) {
    try {
      const result = await this.useCases.restoreOriginalImage(session).execute({
        watermarkJobId: jobId,
        shopDomain: session.shop,
      });
      return { success: true, result };
    } catch (error) {
      throw toHttpException("Publication", error);
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
