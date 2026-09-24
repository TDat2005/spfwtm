export type ProductMediaChangeKind =
  | "SOURCE_INITIALIZED"
  | "SOURCE_UNCHANGED"
  | "APP_MEDIA_PUBLISHED"
  | "APP_PUBLICATION_PENDING"
  | "MERCHANT_PRIMARY_CHANGED"
  | "MEDIA_REORDERED"
  | "PRIMARY_REMOVED"
  | "PRODUCT_DELETED";

export interface ProductMediaItem {
  id: string;
  imageUrl: string | null;
  altText: string | null;
  createdAt: Date | null;
}

export interface ProductMediaState {
  productId: string;
  title: string;
  status: "ACTIVE" | "DRAFT" | "ARCHIVED";
  primaryMedia: ProductMediaItem | null;
  media: readonly ProductMediaItem[];
}

export interface ProductMediaChange {
  kind: ProductMediaChangeKind;
  primaryMedia: ProductMediaItem | null;
}
