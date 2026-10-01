import type { PrismaClient } from "../../../generated/prisma/client.ts";

import { Product } from "../domain/Product.ts";
import type { ProductRepository } from "../application/ProductRepository.ts";

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

      // Một query đọc cho cả trang thay vì findUnique từng sản phẩm.
      const existingRows = await transaction.catalogProduct.findMany({
        where: {
          shopId: shop.id,
          shopifyProductId: { in: products.map((product) => product.id) },
        },
        select: { shopifyProductId: true, sourceMediaId: true },
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
              imageUrl: product.imageUrl,
              imageAltText: product.imageAltText,
              sourceMediaId: product.mediaId,
            },
          });
        } else {
          await transaction.catalogProduct.update({
            where,
            data: {
              title: product.title,
              status: product.status,
              deletedAt: null,
              ...(existing.sourceMediaId
                ? {}
                : {
                    imageUrl: product.imageUrl,
                    imageAltText: product.imageAltText,
                    sourceMediaId: product.mediaId,
                  }),
            },
          });
        }
      }
    }, {
      // Mặc định 5s không đủ cho một trang 250 sản phẩm.
      timeout: 30_000,
    });
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
          imageUrl: row.imageUrl,
          imageAltText: row.imageAltText,
          mediaId: row.sourceMediaId,
          needsReview: row.needsReview,
          sourceVersion: row.sourceVersion,
        })
    );
  }
}
