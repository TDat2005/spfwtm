import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleInit,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { SHOPIFY_API_VERSION } from "../../../../shopify.js";
import { SHOPIFY, type ShopifyApp } from "../../../shared/nest/tokens.ts";
import {
  CATALOG_RECONCILE_V1,
  PRODUCT_MEDIA_RECONCILE_V1,
  assertJobVersion,
} from "../../jobs/domain/JobDefinitions.ts";
import { BullMqJobQueue } from "../../jobs/infrastructure/BullMqJobQueue.ts";
import { BullMqWorker } from "../../jobs/infrastructure/BullMqWorker.ts";
import { ReceiveProductWebhook } from "../application/ReceiveProductWebhook.ts";
import { ReconcileProductMedia } from "../application/ReconcileProductMedia.ts";
import { PrismaWebhookInboxRepository } from "./PrismaWebhookInboxRepository.ts";
import { ShopifyProductMediaGateway } from "./ShopifyProductMediaGateway.ts";

/**
 * Đăng ký handler cho job đồng bộ media sản phẩm và lịch reconcile hằng ngày.
 * onModuleInit: đăng ký handler (trước khi JobsModule start worker).
 * onApplicationBootstrap: đăng ký cron với Redis.
 */
@Injectable()
export class ProductMediaSyncJobHandlers implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger("BullMQ");

  constructor(
    @Inject(BullMqWorker) private readonly worker: BullMqWorker,
    @Inject(BullMqJobQueue) private readonly queue: BullMqJobQueue,
    @Inject(SHOPIFY) private readonly shopify: ShopifyApp,
    @Inject(PrismaWebhookInboxRepository)
    private readonly webhookInbox: PrismaWebhookInboxRepository,
    @Inject(ReceiveProductWebhook) private readonly receiveProductWebhook: ReceiveProductWebhook,
  ) {}

  onModuleInit(): void {
    this.worker.registerHandler(PRODUCT_MEDIA_RECONCILE_V1.jobName, async (payload) => {
      assertJobVersion(payload, PRODUCT_MEDIA_RECONCILE_V1);
      await this.reconcileProductMedia(payload);
    });

    this.worker.registerHandler(CATALOG_RECONCILE_V1.jobName, async (payload) => {
      assertJobVersion(payload, CATALOG_RECONCILE_V1);
      await this.reconcileCatalog();
    });
  }

  onApplicationBootstrap(): void {
    // Không await: Redis chậm cũng không chặn app khởi động.
    void this.queue
      .upsertDailyJob(
        CATALOG_RECONCILE_V1,
        process.env.CATALOG_RECONCILE_CRON || "0 3 * * *",
        process.env.CATALOG_RECONCILE_TIMEZONE || "Asia/Ho_Chi_Minh",
      )
      .catch((error: unknown) => {
        this.logger.error(
          `Không thể đăng ký CATALOG_RECONCILE_V1: ${error instanceof Error ? error.message : error}`,
        );
      });
  }

  private async reconcileProductMedia(payload: Record<string, unknown>): Promise<void> {
    const webhookId = String(payload.webhookId ?? "");
    const shopDomain = String(payload.shopDomain ?? "");
    if (!webhookId || !shopDomain) {
      throw new Error("PRODUCT_MEDIA_RECONCILE_V1 thiếu webhookId hoặc shopDomain");
    }

    const offlineSessionId = this.shopify.api.session.getOfflineId(shopDomain);
    const session = await this.shopify.config.sessionStorage.loadSession(offlineSessionId);
    if (!session) {
      throw new Error(`Không tìm thấy offline session cho ${shopDomain}`);
    }

    const reconcile = new ReconcileProductMedia(
      this.webhookInbox,
      new ShopifyProductMediaGateway(this.shopify, session),
    );
    await reconcile.execute(webhookId);
  }

  private async reconcileCatalog(): Promise<void> {
    const changedSince = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const candidates = await this.webhookInbox.listReconciliationCandidates(changedSince);
    const day = new Date().toISOString().slice(0, 10);

    for (const candidate of candidates) {
      const key = createHash("sha256")
        .update(`${candidate.shopDomain}\0${candidate.productId}`)
        .digest("hex")
        .slice(0, 32);
      await this.receiveProductWebhook.execute({
        webhookId: `catalog-reconcile-${day}-${key}`,
        shopDomain: candidate.shopDomain,
        topic: "CATALOG_RECONCILE",
        apiVersion: SHOPIFY_API_VERSION,
        body: JSON.stringify({
          admin_graphql_api_id: candidate.productId,
          updated_at: candidate.updatedAt.toISOString(),
        }),
      });
    }
  }
}
