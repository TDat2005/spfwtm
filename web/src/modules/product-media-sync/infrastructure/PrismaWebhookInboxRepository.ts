import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type {
  RecordWebhookDeliveryInput,
  RecordWebhookDeliveryResult,
  WebhookInboxWriter,
} from "../application/ReceiveProductWebhook.ts";
import type {
  ProductMediaReconcileRepository,
  ProductMediaTrackingState,
  WebhookInboxItem,
} from "../application/ReconcileProductMedia.ts";
import type {
  ProductMediaChange,
  ProductMediaState,
} from "../domain/ProductMediaChange.ts";

export class PrismaWebhookInboxRepository
  implements WebhookInboxWriter, ProductMediaReconcileRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async recordDelivery(
    input: RecordWebhookDeliveryInput
  ): Promise<RecordWebhookDeliveryResult> {
    const shop = await this.prisma.shop.upsert({
      where: { domain: input.shopDomain },
      create: { domain: input.shopDomain },
      update: {},
      select: { id: true },
    });
    const id = randomUUID();

    try {
      await this.prisma.webhookInbox.create({
        data: {
          id,
          webhookId: input.webhookId,
          eventId: input.eventId,
          shopId: shop.id,
          topic: input.topic,
          apiVersion: input.apiVersion,
          triggeredAt: input.triggeredAt,
          productId: input.productId,
          payload: input.payload,
          status: "RECEIVED",
        },
      });
      return { inboxId: id, shouldEnqueue: true };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;

      const existing = await this.prisma.webhookInbox.findUnique({
        where: { webhookId: input.webhookId },
        include: { shop: { select: { domain: true } } },
      });
      if (!existing || existing.shop.domain !== input.shopDomain) {
        throw new Error("Webhook ID đã thuộc về shop khác");
      }

      if (existing.status === "FAILED") {
        const claimed = await this.prisma.webhookInbox.updateMany({
          where: { id: existing.id, status: "FAILED" },
          data: { status: "RECEIVED", errorMessage: null },
        });
        return {
          inboxId: existing.id,
          shouldEnqueue: claimed.count === 1,
        };
      }

      return { inboxId: existing.id, shouldEnqueue: false };
    }
  }

  async markEnqueued(inboxId: string): Promise<void> {
    await this.prisma.webhookInbox.updateMany({
      where: { id: inboxId, status: "RECEIVED" },
      data: { status: "ENQUEUED", errorMessage: null },
    });
  }

  async beginProcessing(webhookId: string): Promise<WebhookInboxItem | null> {
    const row = await this.prisma.webhookInbox.findUnique({
      where: { webhookId },
      include: { shop: { select: { domain: true } } },
    });
    if (!row || row.status === "PROCESSED" || row.status === "IGNORED") {
      return null;
    }

    const claimed = await this.prisma.webhookInbox.updateMany({
      where: {
        id: row.id,
        status: { in: ["RECEIVED", "ENQUEUED", "FAILED"] },
      },
      data: { status: "PROCESSING", errorMessage: null },
    });
    if (claimed.count !== 1) return null;

    return {
      id: row.id,
      webhookId: row.webhookId,
      shopDomain: row.shop.domain,
      productId: row.productId,
      triggeredAt: row.triggeredAt,
    };
  }

  async getTrackingState(
    shopDomain: string,
    productId: string
  ): Promise<ProductMediaTrackingState> {
    const activeSince = new Date(Date.now() - 15 * 60 * 1000);
    const [product, published, publishing] = await Promise.all([
      this.prisma.catalogProduct.findFirst({
        where: {
          shopifyProductId: productId,
          shop: { domain: shopDomain },
        },
        select: { sourceMediaId: true },
      }),
      this.prisma.publishedMedia.findMany({
        where: {
          shopifyProductId: productId,
          shop: { domain: shopDomain },
        },
        select: { shopifyMediaId: true },
      }),
      this.prisma.publicationAttempt.findMany({
        where: {
          productId,
          status: "PUBLISHING",
          createdAt: { gte: activeSince },
          shop: { domain: shopDomain },
        },
        select: { shopifyMediaId: true },
      }),
    ]);

    return {
      sourceMediaId: product?.sourceMediaId ?? null,
      publishedMediaIds: new Set(
        published.map((media) => media.shopifyMediaId)
      ),
      publishingMediaIds: new Set(
        publishing.flatMap((attempt) =>
          attempt.shopifyMediaId ? [attempt.shopifyMediaId] : []
        )
      ),
      hasPublicationWithoutMediaId: publishing.some(
        (attempt) => !attempt.shopifyMediaId
      ),
    };
  }

  async applyChange(input: {
    inbox: WebhookInboxItem;
    product: ProductMediaState | null;
    change: ProductMediaChange;
  }): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const shop = await transaction.shop.findUnique({
        where: { domain: input.inbox.shopDomain },
        select: { id: true },
      });
      if (!shop) throw new Error("Không tìm thấy shop khi reconcile media");

      const catalogProduct = await transaction.catalogProduct.findUnique({
        where: {
          shopId_shopifyProductId: {
            shopId: shop.id,
            shopifyProductId: input.inbox.productId,
          },
        },
        select: { id: true },
      });

      if (input.change.kind === "PRODUCT_DELETED") {
        if (catalogProduct) {
          await transaction.catalogProduct.update({
            where: { id: catalogProduct.id },
            data: { deletedAt: new Date(), needsReview: true },
          });
          await cancelPendingWatermarks(transaction, catalogProduct.id);
        }
      } else if (input.product) {
        const product = await ensureCatalogProduct(
          transaction,
          shop.id,
          input.product
        );
        await transaction.catalogProduct.update({
          where: { id: product.id },
          data: {
            title: input.product.title,
            status: input.product.status,
            deletedAt: null,
          },
        });

        if (input.change.kind === "SOURCE_INITIALIZED") {
          await transaction.catalogProduct.update({
            where: { id: product.id },
            data: sourceUpdate(input.change, false),
          });
        } else if (input.change.kind === "MERCHANT_PRIMARY_CHANGED") {
          await transaction.catalogProduct.update({
            where: { id: product.id },
            data: {
              ...sourceUpdate(input.change, true),
              sourceVersion: { increment: 1 },
            },
          });
        } else if (input.change.kind === "PRIMARY_REMOVED") {
          await transaction.catalogProduct.update({
            where: { id: product.id },
            data: {
              imageUrl: null,
              imageAltText: null,
              sourceMediaId: null,
              sourceContentHash: null,
              sourceVersion: { increment: 1 },
              needsReview: true,
            },
          });
          await cancelPendingWatermarks(transaction, product.id);
        } else if (input.change.kind === "SOURCE_UNCHANGED") {
          await transaction.catalogProduct.update({
            where: { id: product.id },
            data: {
              imageUrl: input.change.primaryMedia?.imageUrl ?? null,
              imageAltText: input.change.primaryMedia?.altText ?? null,
            },
          });
        }
      }

      await transaction.webhookInbox.update({
        where: { id: input.inbox.id },
        data: {
          status: isIgnored(input.change) ? "IGNORED" : "PROCESSED",
          processedAt: new Date(),
          errorMessage: null,
        },
      });
    });
  }

  async defer(inboxId: string): Promise<void> {
    await this.prisma.webhookInbox.update({
      where: { id: inboxId },
      data: { status: "ENQUEUED", errorMessage: null },
    });
  }

  async markFailed(inboxId: string, message: string): Promise<void> {
    await this.prisma.webhookInbox.updateMany({
      where: {
        id: inboxId,
        status: { notIn: ["PROCESSED", "IGNORED"] },
      },
      data: { status: "FAILED", errorMessage: message },
    });
  }

  async listReconciliationCandidates(
    changedSince: Date
  ): Promise<Array<{
    shopDomain: string;
    productId: string;
    updatedAt: Date;
  }>> {
    const rows = await this.prisma.catalogProduct.findMany({
      where: {
        deletedAt: null,
        updatedAt: { gte: changedSince },
      },
      include: { shop: { select: { domain: true } } },
      orderBy: { updatedAt: "asc" },
    });
    return rows.map((row) => ({
      shopDomain: row.shop.domain,
      productId: row.shopifyProductId,
      updatedAt: row.updatedAt,
    }));
  }
}

function sourceUpdate(change: ProductMediaChange, needsReview: boolean) {
  const primary = change.primaryMedia;
  if (!primary) throw new Error("Thay đổi ảnh nguồn phải có primary media");
  return {
    imageUrl: primary.imageUrl,
    imageAltText: primary.altText,
    sourceMediaId: primary.id,
    sourceContentHash: null,
    needsReview,
  };
}

function isIgnored(change: ProductMediaChange): boolean {
  return (
    change.kind === "SOURCE_UNCHANGED" ||
    change.kind === "APP_MEDIA_PUBLISHED" ||
    change.kind === "MEDIA_REORDERED"
  );
}

async function ensureCatalogProduct(
  transaction: TransactionClient,
  shopId: string,
  product: ProductMediaState
): Promise<{ id: string }> {
  return transaction.catalogProduct.upsert({
    where: {
      shopId_shopifyProductId: {
        shopId,
        shopifyProductId: product.productId,
      },
    },
    create: {
      shopId,
      shopifyProductId: product.productId,
      title: product.title,
      status: product.status,
      imageUrl: null,
      imageAltText: null,
    },
    update: {},
    select: { id: true },
  });
}

async function cancelPendingWatermarks(
  transaction: TransactionClient,
  catalogProductId: string
): Promise<void> {
  await transaction.watermarkJob.updateMany({
    where: { catalogProductId, status: "PENDING" },
    data: { status: "CANCELLED" },
  });
}

type TransactionClient = Parameters<
  Parameters<PrismaClient["$transaction"]>[0]
>[0];

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
