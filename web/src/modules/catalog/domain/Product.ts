export type ProductStatus = "ACTIVE" | "DRAFT" | "ARCHIVED";

interface ProductProps {
  id: string;
  title: string;
  status: ProductStatus;
  imageUrl: string | null;
  imageAltText: string | null;
}

export class Product {
  readonly id: string;
  readonly title: string;
  readonly status: ProductStatus;
  readonly imageUrl: string | null;
  readonly imageAltText: string | null;

  constructor({
    id,
    title,
    status,
    imageUrl,
    imageAltText,
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
    this.imageUrl = imageUrl;
    this.imageAltText = imageAltText;
  }
}