export interface WatermarkResult {
    productId: string;
    bytes: Buffer;
    mimeType: string;
    defaultAltText?: string | null;
}
export interface WatermarkResultReader {
    read(watermarkJobId: string,
        shopDomain: string,): Promise<WatermarkResult | null>;
}