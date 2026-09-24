import type {
  ProductMediaChange,
  ProductMediaState,
} from "./ProductMediaChange.ts";

export interface MediaChangeClassifierInput {
  product: ProductMediaState | null;
  sourceMediaId: string | null;
  publishedMediaIds: ReadonlySet<string>;
  publishingMediaIds: ReadonlySet<string>;
  hasPublicationWithoutMediaId: boolean;
  webhookTriggeredAt: Date;
}

const NEW_MEDIA_WINDOW_MS = 10 * 60 * 1000;

export class MediaChangeClassifier {
  classify(input: MediaChangeClassifierInput): ProductMediaChange {
    if (!input.product) {
      return { kind: "PRODUCT_DELETED", primaryMedia: null };
    }

    const primary = input.product.primaryMedia;
    if (!primary) {
      return { kind: "PRIMARY_REMOVED", primaryMedia: null };
    }

    if (input.publishedMediaIds.has(primary.id)) {
      return { kind: "APP_MEDIA_PUBLISHED", primaryMedia: primary };
    }

    if (
      input.publishingMediaIds.has(primary.id) ||
      input.hasPublicationWithoutMediaId
    ) {
      return { kind: "APP_PUBLICATION_PENDING", primaryMedia: primary };
    }

    if (!input.sourceMediaId) {
      return { kind: "SOURCE_INITIALIZED", primaryMedia: primary };
    }

    if (primary.id === input.sourceMediaId) {
      return { kind: "SOURCE_UNCHANGED", primaryMedia: primary };
    }

    const sourceStillExists = input.product.media.some(
      (media) => media.id === input.sourceMediaId
    );
    if (
      sourceStillExists &&
      !wasCreatedForThisUpdate(primary.createdAt, input.webhookTriggeredAt)
    ) {
      return { kind: "MEDIA_REORDERED", primaryMedia: primary };
    }

    return { kind: "MERCHANT_PRIMARY_CHANGED", primaryMedia: primary };
  }
}

function wasCreatedForThisUpdate(
  mediaCreatedAt: Date | null,
  webhookTriggeredAt: Date
): boolean {
  if (!mediaCreatedAt) return false;
  return (
    Math.abs(webhookTriggeredAt.getTime() - mediaCreatedAt.getTime()) <=
    NEW_MEDIA_WINDOW_MS
  );
}
