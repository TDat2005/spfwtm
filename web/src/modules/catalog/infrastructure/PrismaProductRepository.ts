import type { PrismaClient } from "../../../generated/prisma/client.ts";

import { Product } from "../domain/Product.ts";
import type {
  ProductRepository,
  ProductTypeSummary,
} from "../application/ProductRepository.ts";

export class PrismaProductRepository implements ProductRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertMany(
    shopDomain: string,
    products: readonly Product[]
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const shop = await transaction.shop.upsert({
        where: {
          domain: shopDomain,
        },
        create: {
          domain: shopDomain,
        },
        update: {},
      });

      const publishedRows = await transaction.publishedMedia.findMany({
        where: { shopId: shop.id },
        select: { shopifyMediaId: true },
      });
      const publishedMediaIds = new Set(
        publishedRows.map((row) => row.shopifyMediaId)
      );

      const existingRows = await transaction.catalogProduct.findMany({
        where: {
          shopId: shop.id,
          shopifyProductId: { in: products.map((product) => product.id) },
        },
        select: {
          shopifyProductId: true,
          sourceMediaId: true,
          originalImageUrl: true,
          imageUrl: true,
        },
      });
      const existingById = new Map(
        existingRows.map((row) => [row.shopifyProductId, row])
      );

      for (const product of products) {
        const where = {
          shopId_shopifyProductId: {
            shopId: shop.id,
            shopifyProductId: product.id,
          },
        };
        const existing = existingById.get(product.id);

        if (!existing) {
          await transaction.catalogProduct.create({
            data: {
              shopId: shop.id,
              shopifyProductId: product.id,
              title: product.title,
              status: product.status,
              productType: product.productType,
              imageUrl: product.imageUrl,
              originalImageUrl: product.imageUrl,
              imageAltText: product.imageAltText,
              sourceMediaId: product.mediaId,
              needsReview: false,
              sourceVersion: 1,
            },
          });
        } else {
          const isAppPublishedMedia =
            product.mediaId !== null && publishedMediaIds.has(product.mediaId);

          if (isAppPublishedMedia) {
            // Shopify's primary media is the app's published watermarked image.
            // Do NOT overwrite originalImageUrl or sourceMediaId!
            await transaction.catalogProduct.update({
              where,
              data: {
                title: product.title,
                status: product.status,
                productType: product.productType,
                deletedAt: null,
                imageUrl: product.imageUrl,
                imageAltText: product.imageAltText,
              },
            });
          } else if (
            product.mediaId &&
            existing.sourceMediaId &&
            product.mediaId !== existing.sourceMediaId
          ) {
            // Merchant changed the primary image on Shopify!
            // Update originalImageUrl and mark needsReview = true!
            await transaction.catalogProduct.update({
              where,
              data: {
                title: product.title,
                status: product.status,
                productType: product.productType,
                deletedAt: null,
                imageUrl: product.imageUrl,
                originalImageUrl: product.imageUrl,
                imageAltText: product.imageAltText,
                sourceMediaId: product.mediaId,
                needsReview: true,
                sourceVersion: { increment: 1 },
              },
            });
          } else {
            // Media unchanged, or existing didn't have sourceMediaId yet
            await transaction.catalogProduct.update({
              where,
              data: {
                title: product.title,
                status: product.status,
                productType: product.productType,
                deletedAt: null,
                imageUrl: product.imageUrl,
                imageAltText: product.imageAltText,
                sourceMediaId: existing.sourceMediaId ?? product.mediaId,
                originalImageUrl:
                  existing.originalImageUrl ??
                  (isAppPublishedMedia ? null : product.imageUrl),
              },
            });
          }
        }
      }
    }, {
      timeout: 30_000,
    });
  }

  async listProductTypes(shopDomain: string): Promise<ProductTypeSummary[]> {
    const where = { shop: { domain: shopDomain }, deletedAt: null };
    const [all, withImage] = await Promise.all([
      this.prisma.catalogProduct.groupBy({
        by: ["productType"],
        where,
        _count: { _all: true },
      }),
      this.prisma.catalogProduct.groupBy({
        by: ["productType"],
        where: { ...where, imageUrl: { not: null } },
        _count: { _all: true },
      }),
    ]);
    const withImageByType = new Map(
      withImage.map((row) => [row.productType, row._count._all])
    );

    return all
      .map((row) => ({
        productType: row.productType,
        productCount: row._count._all,
        withImageCount: withImageByType.get(row.productType) ?? 0,
      }))
      .sort((a, b) => a.productType.localeCompare(b.productType, "vi"));
  }

  async listByShop(shopDomain: string): Promise<Product[]> {
    const rows = await this.prisma.catalogProduct.findMany({
      where: {
        shop: {
          domain: shopDomain,
        },
        deletedAt: null,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    return rows.map(
      (row) =>
        new Product({
          id: row.shopifyProductId,
          title: row.title,
          status: row.status,
          productType: row.productType,
          imageUrl: row.imageUrl,
          originalImageUrl: row.originalImageUrl ?? row.imageUrl,
          imageAltText: row.imageAltText,
          mediaId: row.sourceMediaId,
          needsReview: row.needsReview,
          sourceVersion: row.sourceVersion,
        })
    );
  }
}
