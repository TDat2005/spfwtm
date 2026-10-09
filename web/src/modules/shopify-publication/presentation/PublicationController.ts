import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
} from "@nestjs/common";
import type { Session } from "@shopify/shopify-api";
import { ShopifySession } from "../../../shared/nest/ShopifySession.ts";
import { toHttpException } from "../../../shared/nest/toHttpException.ts";
import { parseCatalogFilter } from "../../watermark/domain/CatalogFilter.ts";
import { ListPublishedMedia } from "../application/ListPublishedMedia.ts";
import {
  QueueProductRestores,
  type RestoreSelection,
} from "../application/QueueProductRestores.ts";
import type { PublishedMedia } from "../domain/PublishedMedia.ts";
import { PublicationUseCaseFactory } from "../infrastructure/PublicationUseCaseFactory.ts";
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import { PRISMA_CLIENT } from "../../../shared/nest/tokens.ts";
import { EnqueueJob } from "../../jobs/application/EnqueueJob.ts";
import { batchPublishJob } from "../application/BatchPublishJob.ts";

@Controller("api/publications")
export class PublicationController {
  constructor(
    @Inject(ListPublishedMedia) private readonly listPublishedMedia: ListPublishedMedia,
    @Inject(PublicationUseCaseFactory) private readonly useCases: PublicationUseCaseFactory,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(EnqueueJob) private readonly enqueueJob: EnqueueJob,
    @Inject(QueueProductRestores) private readonly queueProductRestores: QueueProductRestores,
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
        // Ảnh mới thành ảnh chính và gỡ ảnh watermark cũ của app trên sản phẩm.
        replacePrevious: true,
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

      // Ghi yêu cầu TRƯỚC khi đọc job đã xong: job nào xong sau thời điểm này sẽ
      // tự publish (WatermarkJobHandlers), job xong trước được đưa vào queue ngay
      // dưới đây, nên không job nào bị sót.
      const requested = await this.prisma.watermarkBatch.updateMany({
        where: { id: batchId, shopId: shop.id },
        data: { publishRequestedAt: new Date() },
      });
      if (requested.count === 0) throw new Error("Không tìm thấy watermark batch");

      const [jobs, pendingCount] = await Promise.all([
        this.prisma.watermarkJob.findMany({
          where: {
            batchId,
            shopId: shop.id,
            status: "COMPLETED",
            publishedMedia: null,
          },
          select: { id: true },
        }),
        this.prisma.watermarkJob.count({
          where: { batchId, shopId: shop.id, status: { in: ["PENDING", "PROCESSING"] } },
        }),
      ]);

      await this.enqueueJob.executeMany(
        jobs.map((job) => batchPublishJob(job.id, session.shop)),
      );

      return { success: true, queuedCount: jobs.length, pendingCount };
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

  /** Khôi phục ảnh gốc cho các sản phẩm merchant chọn (hoặc mọi sản phẩm khớp bộ lọc), chạy nền. */
  @Post("products/restore")
  @HttpCode(HttpStatus.ACCEPTED)
  async restoreSelectedProducts(
    @Body() body: Record<string, unknown>,
    @ShopifySession() session: Session,
  ) {
    const selection = parseRestoreSelection(body);
    try {
      const result = await this.queueProductRestores.execute(session.shop, selection);
      return { success: true, ...result };
    } catch (error) {
      throw toHttpException("Publication", error, HttpStatus.BAD_REQUEST);
    }
  }

  /** Khôi phục mọi sản phẩm đang có ảnh watermark của app, chạy nền (một job mỗi sản phẩm). */
  @Post("restore-all")
  @HttpCode(HttpStatus.ACCEPTED)
  async restoreAll(@ShopifySession() session: Session) {
    try {
      const { queuedCount } = await this.queueProductRestores.executeAll(session.shop);
      return { success: true, queuedCount };
    } catch (error) {
      throw toHttpException("Publication", error);
    }
  }
}

/** Nhận đúng một trong hai: `{ productIds: [...] }` hoặc `{ filter: {...} }`. */
function parseRestoreSelection(body: Record<string, unknown>): RestoreSelection {
  const hasIds = body.productIds !== undefined;
  const hasFilter = body.filter !== undefined;
  if (hasIds === hasFilter) {
    throw new BadRequestException({ error: "Cần gửi đúng một trong hai: productIds hoặc filter" });
  }
  if (hasFilter) {
    try {
      return { kind: "FILTER", filter: parseCatalogFilter(body.filter) };
    } catch (error) {
      throw new BadRequestException({
        error: error instanceof Error ? error.message : "Bộ lọc sản phẩm không hợp lệ",
      });
    }
  }
  if (!Array.isArray(body.productIds) || !body.productIds.every((id) => typeof id === "string")) {
    throw new BadRequestException({ error: "productIds phải là một mảng chuỗi" });
  }
  return { kind: "PRODUCT_IDS", productIds: body.productIds };
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
