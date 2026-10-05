import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post } from "@nestjs/common";
import type { Session } from "@shopify/shopify-api";
import { ShopifySession } from "../../../shared/nest/ShopifySession.ts";
import { toHttpException } from "../../../shared/nest/toHttpException.ts";
import { ListPublishedMedia } from "../application/ListPublishedMedia.ts";
import type { PublishedMedia } from "../domain/PublishedMedia.ts";
import { PublicationUseCaseFactory } from "../infrastructure/PublicationUseCaseFactory.ts";
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import { PRISMA_CLIENT, SHOPIFY, type ShopifyApp } from "../../../shared/nest/tokens.ts";

@Controller("api/publications")
export class PublicationController {
  constructor(
    @Inject(ListPublishedMedia) private readonly listPublishedMedia: ListPublishedMedia,
    @Inject(PublicationUseCaseFactory) private readonly useCases: PublicationUseCaseFactory,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(SHOPIFY) private readonly shopify: ShopifyApp,
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
        },
        select: { id: true },
      });

      let publishedCount = 0;
      let failedCount = 0;
      const errors: Array<{ jobId: string; error: string }> = [];

      const publisher = this.useCases.publishWatermarkedImage(session);

      for (const job of jobs) {
        try {
          await publisher.execute({
            watermarkJobId: job.id,
            shopDomain: session.shop,
          });
          publishedCount++;
        } catch (err: unknown) {
          failedCount++;
          errors.push({
            jobId: job.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return {
        success: true,
        totalCompleted: jobs.length,
        publishedCount,
        failedCount,
        errors,
      };
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
      const result = await this.performProductRestore(decodedProductId, session);
      return { success: true, ...result };
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

      let restoredCount = 0;
      for (const pid of productIds) {
        try {
          await this.performProductRestore(pid, session);
          restoredCount++;
        } catch {
          // Continue with remaining products
        }
      }

      return { success: true, restoredCount };
    } catch (error) {
      throw toHttpException("Publication", error);
    }
  }

  private async performProductRestore(decodedProductId: string, session: Session) {
    const shop = await this.prisma.shop.findUnique({
      where: { domain: session.shop },
    });
    if (!shop) throw new Error("Shop không tồn tại");

    const catalogProduct = await this.prisma.catalogProduct.findFirst({
      where: {
        shopId: shop.id,
        shopifyProductId: decodedProductId,
      },
    });

    const publishedRecords = await this.prisma.publishedMedia.findMany({
      where: {
        shopId: shop.id,
        shopifyProductId: decodedProductId,
      },
    });

    const client = new this.shopify.api.clients.Graphql({ session });
    const mediaIdsToDelete: string[] = publishedRecords.map((r) => r.shopifyMediaId);

    // Query Shopify for current media list
    const productQuery = await client.request<{
      product?: {
        id: string;
        media: {
          nodes: Array<{
            id: string;
            mediaContentType: string;
            image?: { url: string };
          }>;
        };
      };
    }>(
      `query GetProductMedia($id: ID!) {
        product(id: $id) {
          id
          media(first: 20) {
            nodes {
              id
              mediaContentType
              ... on MediaImage {
                image {
                  url
                }
              }
            }
          }
        }
      }`,
      { variables: { id: decodedProductId } }
    );

    const allMedia = productQuery.data?.product?.media.nodes ?? [];

    for (const m of allMedia) {
      if (
        m.image?.url &&
        (m.image.url.includes("/wm-") || (catalogProduct?.sourceMediaId && m.id === catalogProduct.sourceMediaId)) &&
        allMedia.length > 1
      ) {
        if (!mediaIdsToDelete.includes(m.id)) {
          mediaIdsToDelete.push(m.id);
        }
      }
    }

    if (mediaIdsToDelete.length > 0) {
      await client.request(
        `mutation ProductDeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
          productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
            deletedMediaIds
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            productId: decodedProductId,
            mediaIds: mediaIdsToDelete,
          },
        }
      );
    }

    if (publishedRecords.length > 0) {
      await this.prisma.publishedMedia.deleteMany({
        where: {
          shopId: shop.id,
          shopifyProductId: decodedProductId,
        },
      });
    }

    // Query Shopify again to get the new primary media
    const refreshedQuery = await client.request<{
      product?: {
        media: {
          nodes: Array<{
            id: string;
            image?: { url: string };
          }>;
        };
      };
    }>(
      `query GetRefreshedMedia($id: ID!) {
        product(id: $id) {
          media(first: 1) {
            nodes {
              id
              ... on MediaImage {
                image {
                  url
                }
              }
            }
          }
        }
      }`,
      { variables: { id: decodedProductId } }
    );

    const newPrimary = refreshedQuery.data?.product?.media.nodes[0];
    const newImageUrl = newPrimary?.image?.url ?? catalogProduct?.originalImageUrl ?? null;
    const newMediaId = newPrimary?.id ?? null;

    if (catalogProduct) {
      await this.prisma.catalogProduct.update({
        where: { id: catalogProduct.id },
        data: {
          imageUrl: newImageUrl,
          originalImageUrl: newImageUrl,
          sourceMediaId: newMediaId,
          needsReview: false,
        },
      });
    }

    return {
      productId: decodedProductId,
      restoredImageUrl: newImageUrl,
    };
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
