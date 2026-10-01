export type ProductStatus = "ACTIVE" | "DRAFT" | "ARCHIVED";

interface ProductProps {
  id: string;
  title: string;
  status: ProductStatus;
  productType?: string;
  imageUrl: string | null;
  imageAltText: string | null;
  mediaId?: string | null;
  needsReview?: boolean;
  sourceVersion?: number;
}

export class Product {
  readonly id: string;
  readonly title: string;
  readonly status: ProductStatus;
  readonly productType: string;
  readonly imageUrl: string | null;
  readonly imageAltText: string | null;
  readonly mediaId: string | null;
  readonly needsReview: boolean;
  readonly sourceVersion: number;

  constructor({
    id,
    title,
    status,
    productType,
    imageUrl,
    imageAltText,
    mediaId,
    needsReview,
    sourceVersion,
  }: ProductProps) {
    if (!id.trim()) {
      throw new Error("Product ID không được để trống");
    }

    if (!title.trim()) {
      throw new Error("Product title không được để trống");
    }

    this.id = id;
    this.title = title;
    this.status = status;
    this.productType = productType?.trim() ?? "";
    this.imageUrl = imageUrl;
    this.imageAltText = imageAltText;
    this.mediaId = mediaId ?? null;
    this.needsReview = needsReview ?? false;
    this.sourceVersion = sourceVersion ?? 1;
  }
}
