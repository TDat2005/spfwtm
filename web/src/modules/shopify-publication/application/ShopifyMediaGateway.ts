export interface PublishMediaInput {
    productId: string;
    bytes: Buffer;
    mimeType: string;
    filename: string;
    altText: string;
}
export interface PublishedMediaResult {
    mediaId: string;
    imageUrl: string | null;
}
export interface ShopifyMediaGateway {
    publish(
        input: PublishMediaInput,
    ): Promise<PublishedMediaResult>;
    deleteMedia(
        productId: string,
        mediaIds: string[],
    ): Promise<void>;
}