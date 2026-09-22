interface PublishedMediaProps {
    id: string;
    shopDomain: string;
    watermarkJobId: string;
    productId: string;
    shopifyMediaId: string;
    imageUrl: string | null;
    createdAt?: Date;
}
export class PublishedMedia {
    readonly id: string;
    readonly shopDomain: string;
    readonly watermarkJobId: string;
    readonly productId: string;
    readonly shopifyMediaId: string;
    readonly imageUrl: string | null;
    readonly createdAt: Date;

    constructor(props: PublishedMediaProps) {
        if (!props.id.trim()) {
            throw new Error("PublishedMedia: id không được để trống");
        }
        if (!props.shopDomain.trim()) {
            throw new Error("PublishedMedia: shopDomain không được để trống");
        }
        if (!props.watermarkJobId.trim()) {
            throw new Error("PublishedMedia: watermarkJobId không được để trống");
        }
        if (!props.productId.trim()) {
            throw new Error("PublishedMedia: productId không được để trống");
        }
        if (!props.shopifyMediaId.trim()) {
            throw new Error("PublishedMedia: shopifyMediaId không được để trống");
        }
        this.id = props.id;
        this.shopDomain = props.shopDomain;
        this.watermarkJobId = props.watermarkJobId;
        this.productId = props.productId;
        this.shopifyMediaId = props.shopifyMediaId;
        this.imageUrl = props.imageUrl;
        this.createdAt = props.createdAt ?? new Date();
    }
}