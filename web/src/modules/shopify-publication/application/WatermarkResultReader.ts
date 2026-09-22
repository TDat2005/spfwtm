export interface WatermarkResult {
    productId: string;
    bytes: Buffer;
    mimeType: string;
}
export interface WatermarkResultReader {
    read(watermarkJobId: string,
        shopDomain: string,): Promise<WatermarkResult | null>;
}