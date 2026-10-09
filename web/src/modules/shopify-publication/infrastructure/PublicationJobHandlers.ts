import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import { PRISMA_CLIENT, SHOPIFY, type ShopifyApp } from "../../../shared/nest/tokens.ts";
import {
  PUBLICATION_PUBLISH_V1,
  PUBLICATION_RESTORE_PRODUCT_V1,
  PUBLICATION_RESTORE_V1,
  assertJobVersion,
} from "../../jobs/domain/JobDefinitions.ts";
import { BullMqWorker } from "../../jobs/infrastructure/BullMqWorker.ts";
import { PublicationUseCaseFactory } from "./PublicationUseCaseFactory.ts";

@Injectable()
export class PublicationJobHandlers implements OnModuleInit {
  private readonly logger = new Logger("Publication");

  constructor(
    @Inject(BullMqWorker) private readonly worker: BullMqWorker,
    @Inject(SHOPIFY) private readonly shopify: ShopifyApp,
    @Inject(PublicationUseCaseFactory) private readonly useCases: PublicationUseCaseFactory,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  onModuleInit(): void {
    this.worker.registerHandler(PUBLICATION_PUBLISH_V1.jobName, async (payload) => {
      assertJobVersion(payload, PUBLICATION_PUBLISH_V1);
      await this.publish(payload);
    });

    this.worker.registerHandler(PUBLICATION_RESTORE_V1.jobName, async (payload) => {
      assertJobVersion(payload, PUBLICATION_RESTORE_V1);
      await this.restore(payload);
    });

    this.worker.registerHandler(PUBLICATION_RESTORE_PRODUCT_V1.jobName, async (payload) => {
      assertJobVersion(payload, PUBLICATION_RESTORE_PRODUCT_V1);
      await this.restoreProduct(payload);
    });
  }

  private async publish(payload: Record<string, unknown>): Promise<void> {
    const watermarkJobId = String(payload.watermarkJobId ?? "");
    const shopDomain = String(payload.shopDomain ?? "");
    if (!watermarkJobId || !shopDomain) {
      throw new Error("PUBLICATION_PUBLISH_V1 thiếu watermarkJobId hoặc shopDomain");
    }

    if (payload.onlyIfLatest === true && (await this.hasNewerAutoJob(watermarkJobId))) {
      this.logger.log(`Bỏ qua publish ${watermarkJobId}: sản phẩm đã có job auto mới hơn`);
      return;
    }
    if (payload.onlyIfNewest === true && (await this.hasNewerCompletedJob(watermarkJobId))) {
      this.logger.log(`Bỏ qua publish ${watermarkJobId}: sản phẩm đã có ảnh watermark mới hơn`);
      return;
    }

    const session = await this.offlineSession(shopDomain);
    await this.useCases.publishWatermarkedImage(session).execute({
      watermarkJobId,
      shopDomain,
      replacePrevious: payload.replacePrevious === true,
    });
  }

  /** Gỡ ảnh watermark của một job khỏi Shopify (rule bật restoreOnLeave). */
  private async restore(payload: Record<string, unknown>): Promise<void> {
    const watermarkJobId = String(payload.watermarkJobId ?? "");
    const shopDomain = String(payload.shopDomain ?? "");
    if (!watermarkJobId || !shopDomain) {
      throw new Error("PUBLICATION_RESTORE_V1 thiếu watermarkJobId hoặc shopDomain");
    }
    // Đã gỡ (bởi merchant hoặc lần chạy trước) thì không còn gì để làm.
    const published = await this.prisma.publishedMedia.count({
      where: { watermarkJobId, shop: { domain: shopDomain } },
    });
    if (published === 0) return;

    const session = await this.offlineSession(shopDomain);
    await this.useCases.restoreOriginalImage(session).execute({ watermarkJobId, shopDomain });
  }

  /** Gỡ mọi ảnh watermark của app khỏi một sản phẩm (merchant khôi phục nhiều sản phẩm). */
  private async restoreProduct(payload: Record<string, unknown>): Promise<void> {
    const productId = String(payload.productId ?? "");
    const shopDomain = String(payload.shopDomain ?? "");
    if (!productId || !shopDomain) {
      throw new Error("PUBLICATION_RESTORE_PRODUCT_V1 thiếu productId hoặc shopDomain");
    }
    const session = await this.offlineSession(shopDomain);
    await this.useCases.restoreProductOriginal(session).execute({ productId, shopDomain });
  }

  private async offlineSession(shopDomain: string) {
    const session = await this.shopify.config.sessionStorage.loadSession(
      this.shopify.api.session.getOfflineId(shopDomain),
    );
    if (!session) {
      throw new Error(`Không tìm thấy offline session cho ${shopDomain}`);
    }
    return session;
  }

  /**
   * Merchant đổi ảnh chính trong lúc job cũ đang render: job mới hơn sẽ publish
   * ảnh đúng; publish job cũ chỉ làm ảnh chính nhảy qua lại.
   */
  private async hasNewerAutoJob(watermarkJobId: string): Promise<boolean> {
    const job = await this.prisma.watermarkJob.findUnique({
      where: { id: watermarkJobId },
      select: { catalogProductId: true, createdAt: true },
    });
    if (!job) return false;
    const newer = await this.prisma.watermarkJob.count({
      where: {
        catalogProductId: job.catalogProductId,
        ruleId: { not: null },
        status: { not: "CANCELLED" },
        createdAt: { gt: job.createdAt },
      },
    });
    return newer > 0;
  }

  /**
   * Publish cả batch luôn gỡ ảnh watermark cũ của app. Batch cũ được bấm publish
   * lại sau batch mới hơn thì không được đè ảnh mới bằng ảnh cũ.
   */
  private async hasNewerCompletedJob(watermarkJobId: string): Promise<boolean> {
    const job = await this.prisma.watermarkJob.findUnique({
      where: { id: watermarkJobId },
      select: { catalogProductId: true, createdAt: true },
    });
    if (!job) return false;
    const newer = await this.prisma.watermarkJob.count({
      where: {
        catalogProductId: job.catalogProductId,
        status: "COMPLETED",
        createdAt: { gt: job.createdAt },
      },
    });
    return newer > 0;
  }
}
