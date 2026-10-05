import type { PrismaClient } from "../../../generated/prisma/client.ts";

import type { PublishedMediaRepository } from "../application/PublishedMediaRepository.ts";
import { PublishedMedia } from "../domain/PublishedMedia.ts";

export class PrismaPublishedMediaRepository
    implements PublishedMediaRepository {
    constructor(
        private readonly prisma: PrismaClient,
    ) { }

    async save(media: PublishedMedia): Promise<void> {
        const shop = await this.prisma.shop.findUnique({
            where: {
                domain: media.shopDomain,
            },
            select: {
                id: true,
            },
        });

        if (!shop) {
            throw new Error("Không tìm thấy shop");
        }

        const watermarkJob =
            await this.prisma.watermarkJob.findFirst({
                where: {
                    id: media.watermarkJobId,
                    shopId: shop.id,
                },
                select: {
                    id: true,
                },
            });

        if (!watermarkJob) {
            throw new Error("Không tìm thấy watermark job");
        }

        await this.prisma.publishedMedia.upsert({
            where: {
                watermarkJobId: media.watermarkJobId,
            },
            create: {
                id: media.id,
                shopId: shop.id,
                watermarkJobId: watermarkJob.id,
                shopifyProductId: media.productId,
                shopifyMediaId: media.shopifyMediaId,
                imageUrl: media.imageUrl,
                createdAt: media.createdAt,
            },
            update: {
                shopifyMediaId: media.shopifyMediaId,
                imageUrl: media.imageUrl,
            },
        });
    }

    async findByJobId(
        watermarkJobId: string,
        shopDomain: string,
    ): Promise<PublishedMedia | null> {
        const row =
            await this.prisma.publishedMedia.findFirst({
                where: {
                    watermarkJobId,
                    shop: {
                        domain: shopDomain,
                    },
                },
                include: {
                    shop: true,
                },
            });

        return row
            ? new PublishedMedia({
                id: row.id,
                shopDomain: row.shop.domain,
                watermarkJobId: row.watermarkJobId,
                productId: row.shopifyProductId,
                shopifyMediaId: row.shopifyMediaId,
                imageUrl: row.imageUrl,
                createdAt: row.createdAt,
            })
            : null;
    }

    async listByShop(
        shopDomain: string,
    ): Promise<PublishedMedia[]> {
        const rows =
            await this.prisma.publishedMedia.findMany({
                where: {
                    shop: {
                        domain: shopDomain,
                    },
                },
                include: {
                    shop: true,
                },
                orderBy: {
                    createdAt: "desc",
                },
            });

        return rows.map(
            (row) =>
                new PublishedMedia({
                    id: row.id,
                    shopDomain: row.shop.domain,
                    watermarkJobId: row.watermarkJobId,
                    productId: row.shopifyProductId,
                    shopifyMediaId: row.shopifyMediaId,
                    imageUrl: row.imageUrl,
                    createdAt: row.createdAt,
                }),
        );
    }

    async delete(id: string): Promise<void> {
        const media = await this.prisma.publishedMedia.findUnique({
            where: { id },
            select: { shopId: true, shopifyProductId: true },
        });

        if (media) {
            const product = await this.prisma.catalogProduct.findUnique({
                where: {
                    shopId_shopifyProductId: {
                        shopId: media.shopId,
                        shopifyProductId: media.shopifyProductId,
                    },
                },
                select: { originalImageUrl: true },
            });

            if (product?.originalImageUrl) {
                await this.prisma.catalogProduct.update({
                    where: {
                        shopId_shopifyProductId: {
                            shopId: media.shopId,
                            shopifyProductId: media.shopifyProductId,
                        },
                    },
                    data: {
                        imageUrl: product.originalImageUrl,
                    },
                });
            }
        }

        await this.prisma.publishedMedia.delete({
            where: { id },
        });
    }
}