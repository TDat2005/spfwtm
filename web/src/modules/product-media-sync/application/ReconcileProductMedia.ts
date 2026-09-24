import type { ProductMediaChange } from "../domain/ProductMediaChange.ts";
import type { ProductMediaState } from "../domain/ProductMediaChange.ts";
import { MediaChangeClassifier } from "../domain/MediaChangeClassifier.ts";

export interface WebhookInboxItem {
  id: string;
  webhookId: string;
  shopDomain: string;
  productId: string;
  triggeredAt: Date;
}

export interface ProductMediaTrackingState {
  sourceMediaId: string | null;
  publishedMediaIds: Set<string>;
  publishingMediaIds: Set<string>;
  hasPublicationWithoutMediaId: boolean;
}

export interface ProductMediaReconcileRepository {
  beginProcessing(webhookId: string): Promise<WebhookInboxItem | null>;
  getTrackingState(
    shopDomain: string,
    productId: string
  ): Promise<ProductMediaTrackingState>;
  applyChange(input: {
    inbox: WebhookInboxItem;
    product: ProductMediaState | null;
    change: ProductMediaChange;
  }): Promise<void>;
  defer(inboxId: string): Promise<void>;
  markFailed(inboxId: string, message: string): Promise<void>;
}

export interface ProductMediaGateway {
  getProductMedia(productId: string): Promise<ProductMediaState | null>;
}

export class PublicationStillInProgressError extends Error {}

export class ReconcileProductMedia {
  constructor(
    private readonly repository: ProductMediaReconcileRepository,
    private readonly gateway: ProductMediaGateway,
    private readonly classifier = new MediaChangeClassifier()
  ) {}

  async execute(webhookId: string): Promise<ProductMediaChange | null> {
    const inbox = await this.repository.beginProcessing(webhookId);
    if (!inbox) return null;

    try {
      const [product, tracking] = await Promise.all([
        this.gateway.getProductMedia(inbox.productId),
        this.repository.getTrackingState(inbox.shopDomain, inbox.productId),
      ]);
      const change = this.classifier.classify({
        product,
        sourceMediaId: tracking.sourceMediaId,
        publishedMediaIds: tracking.publishedMediaIds,
        publishingMediaIds: tracking.publishingMediaIds,
        hasPublicationWithoutMediaId: tracking.hasPublicationWithoutMediaId,
        webhookTriggeredAt: inbox.triggeredAt,
      });

      if (change.kind === "APP_PUBLICATION_PENDING") {
        await this.repository.defer(inbox.id);
        throw new PublicationStillInProgressError(
          "Publication vẫn đang lưu media ID; BullMQ sẽ thử reconcile lại"
        );
      }

      await this.repository.applyChange({ inbox, product, change });
      return change;
    } catch (error) {
      if (!(error instanceof PublicationStillInProgressError)) {
        await this.repository.markFailed(inbox.id, errorMessage(error));
      }
      throw error;
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
