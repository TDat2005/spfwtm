export interface StartPublicationAttemptInput {
  id: string;
  shopDomain: string;
  productId: string;
  watermarkJobId: string;
}

export interface PublicationAttemptRepository {
  start(input: StartPublicationAttemptInput): Promise<void>;
  recordMedia(
    id: string,
    shopDomain: string,
    shopifyMediaId: string
  ): Promise<void>;
  complete(id: string, shopDomain: string): Promise<void>;
  fail(id: string, shopDomain: string): Promise<void>;
}
