export type MediaAssetKind = "SOURCE" | "PROCESSED";

interface MediaAssetProps {
  id: string;
  shopDomain: string;
  kind: MediaAssetKind;
  storageKey: string;
  sourceUrl: string | null;
  mimeType: string;
  contentHash: string;
  byteSize: number;
  createdAt?: Date;
}

export class MediaAsset {
  readonly id: string;
  readonly shopDomain: string;
  readonly kind: MediaAssetKind;
  readonly storageKey: string;
  readonly sourceUrl: string | null;
  readonly mimeType: string;
  readonly contentHash: string;
  readonly byteSize: number;
  readonly createdAt: Date;

  constructor(props: MediaAssetProps) {
    if (!props.id.trim()) throw new Error("Media ID không được để trống");
    if (!props.shopDomain.trim())
      throw new Error("Shop domain không được để trống");
    if (!props.storageKey.trim())
      throw new Error("Storage key không được để trống");
    if (!props.mimeType.startsWith("image/"))
      throw new Error("Media phải là hình ảnh");
    if (!/^[a-f0-9]{64}$/.test(props.contentHash))
      throw new Error("Content hash không hợp lệ");
    if (!Number.isInteger(props.byteSize) || props.byteSize <= 0)
      throw new Error("Kích thước media không hợp lệ");

    this.id = props.id;
    this.shopDomain = props.shopDomain;
    this.kind = props.kind;
    this.storageKey = props.storageKey;
    this.sourceUrl = props.sourceUrl;
    this.mimeType = props.mimeType;
    this.contentHash = props.contentHash;
    this.byteSize = props.byteSize;
    this.createdAt = props.createdAt ?? new Date();
  }
}
