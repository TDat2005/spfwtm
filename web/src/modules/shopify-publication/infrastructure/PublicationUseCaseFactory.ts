import type { Session } from "@shopify/shopify-api";
import type { PublicationAttemptRepository } from "../../product-media-sync/application/PublicationAttemptRepository.ts";
import type { PublishedMediaRepository } from "../application/PublishedMediaRepository.ts";
import { PublishWatermarkedImage } from "../application/PublishWatermarkedImage.ts";
import { RestoreOriginalImage } from "../application/RestoreOriginalImage.ts";
import type { WatermarkResultReader } from "../application/WatermarkResultReader.ts";
import { AdminGraphqlMediaGateway } from "./AdminGraphqlMediaGateway.ts";

type ShopifyApiContext = ConstructorParameters<typeof AdminGraphqlMediaGateway>[0];

/** Tạo use case cần Shopify session của request hiện tại. */
export class PublicationUseCaseFactory {
  constructor(
    private readonly shopify: ShopifyApiContext,
    private readonly watermarkResultReader: WatermarkResultReader,
    private readonly publishedMediaRepository: PublishedMediaRepository,
    private readonly publicationAttempts: PublicationAttemptRepository,
  ) {}

  publishWatermarkedImage(session: Session): PublishWatermarkedImage {
    return new PublishWatermarkedImage(
      this.watermarkResultReader,
      new AdminGraphqlMediaGateway(this.shopify, session),
      this.publishedMediaRepository,
      this.publicationAttempts,
    );
  }

  restoreOriginalImage(session: Session): RestoreOriginalImage {
    return new RestoreOriginalImage(
      this.publishedMediaRepository,
      new AdminGraphqlMediaGateway(this.shopify, session),
    );
  }
}
