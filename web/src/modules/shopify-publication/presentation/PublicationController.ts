import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Logger, Param, Post } from "@nestjs/common";
import type { Session } from "@shopify/shopify-api";
import { ShopifySession } from "../../../shared/nest/ShopifySession.ts";
import { toHttpException } from "../../../shared/nest/toHttpException.ts";
import { ListPublishedMedia } from "../application/ListPublishedMedia.ts";
import type { PublishedMedia } from "../domain/PublishedMedia.ts";
import { PublicationUseCaseFactory } from "../infrastructure/PublicationUseCaseFactory.ts";
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import { PRISMA_CLIENT } from "../../../shared/nest/tokens.ts";
import { EnqueueJob } from "../../jobs/application/EnqueueJob.ts";
import { PUBLICATION_PUBLISH_V1 } from "../../jobs/domain/JobDefinitions.ts";

@Controller("api/publications")
export class PublicationController {
  private readonly logger = new Logger(PublicationController.name);

  constructor(
    @Inject(ListPublishedMedia) private readonly listPublishedMedia: ListPublishedMedia,
    @Inject(PublicationUseCaseFactory) private readonly useCases: PublicationUseCaseFactory,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(EnqueueJob) private readonly enqueueJob: EnqueueJob,
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
        altText: typeof altText === "string" && altText.trim() ? altText.trim() : undefined,
      });
      return { publishedMedia: toResponse(publishedMedia) };
    } catch (error) {
      throw toHttpException("Publication", error);
    }
  }

  @Post("batches/:batchId/publish-all")
  @HttpCode(HttpStatus.OK)
  async publishBatch(
    @Param("batchId") batchId: string,
    @ShopifySession() session: Session,
  ) {
    try {
      const shop = await this.prisma.shop.findUnique({
        where: { domain: session.shop },
      });
      if (!shop) throw new Error("Shop không tồn tại");

      const jobs = await this.prisma.watermarkJob.findMany({
        where: {
          batchId,
          shopId: shop.id,
          status: "COMPLETED",
          publishedMedia: null,
        },
        select: { id: true },
      });

      await this.enqueueJob.executeMany(
        jobs.map((job) => ({
          ...PUBLICATION_PUBLISH_V1,
          jobId: `publish_${job.id}`,
          payload: {
            watermarkJobId: job.id,
            shopDomain: session.shop,
          },
          maxAttempts: 5,
        })),
      );

      return { success: true, queuedCount: jobs.length };
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

  @Post("products/:productId/restore")
  @HttpCode(HttpStatus.OK)
  async restoreProduct(
    @Param("productId") productId: string,
    @ShopifySession() session: Session,
  ) {
    try {
      const decodedProductId = decodeURIComponent(productId);
      const result = await this.useCases.restoreProductOriginal(session).execute({
        productId: decodedProductId,
        shopDomain: session.shop,
      });
      return {
        success: true,
        productId: result.productId,
        restoredImageUrl: result.restoredImageUrl,
      };
    } catch (error) {
      throw toHttpException("Publication", error);
    }
  }

  @Post("restore-all")
  @HttpCode(HttpStatus.OK)
  async restoreAll(@ShopifySession() session: Session) {
    try {
      const shop = await this.prisma.shop.findUnique({
        where: { domain: session.shop },
      });
      if (!shop) throw new Error("Shop không tồn tại");

      // Find products that have publishedMedia or have wm- in imageUrl
      const published = await this.prisma.publishedMedia.findMany({
        where: { shopId: shop.id },
        select: { shopifyProductId: true },
      });

      const wmProducts = await this.prisma.catalogProduct.findMany({
        where: {
          shopId: shop.id,
          OR: [
            { shopifyProductId: { in: published.map((p) => p.shopifyProductId) } },
            { imageUrl: { contains: "/wm-" } },
          ],
        },
        select: { shopifyProductId: true },
      });

      const productIds = Array.from(
        new Set([...published.map((p) => p.shopifyProductId), ...wmProducts.map((p) => p.shopifyProductId)])
      );

      // Chỉ chọn sản phẩm cần xét; việc xóa luôn đi qua use case, chỉ xóa media do app tạo.
      const restoreProductOriginal = this.useCases.restoreProductOriginal(session);
      let restoredCount = 0;
      for (const pid of productIds) {
        try {
          await restoreProductOriginal.execute({ productId: pid, shopDomain: session.shop });
          restoredCount++;
        } catch (error) {
          // Một sản phẩm lỗi không chặn các sản phẩm còn lại, nhưng phải để lại dấu vết.
          this.logger.warn(
            `Không khôi phục được sản phẩm ${pid}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      return { success: true, restoredCount };
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
