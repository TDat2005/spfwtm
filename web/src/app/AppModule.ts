import { Module } from "@nestjs/common";
import { CatalogModule } from "../modules/catalog/CatalogModule.ts";
import { JobsModule } from "../modules/jobs/JobsModule.ts";
import { MediaModule } from "../modules/media/MediaModule.ts";
import { ProductMediaSyncModule } from "../modules/product-media-sync/ProductMediaSyncModule.ts";
import { PublicationModule } from "../modules/shopify-publication/PublicationModule.ts";
import { WatermarkModule } from "../modules/watermark/WatermarkModule.ts";
import { PrismaModule } from "../shared/nest/PrismaModule.ts";
import { ShopifyModule } from "../shared/nest/ShopifyModule.ts";
import { ProductsModule } from "./products/ProductsModule.ts";
import { SpaModule } from "./SpaModule.ts";

/**
 * Module gốc: chỉ ghép các feature module lại với nhau.
 * Mỗi feature module tự khai báo controller, provider và dependency của nó.
 */
@Module({
  imports: [
    PrismaModule,
    ShopifyModule,
    JobsModule,
    CatalogModule,
    MediaModule,
    WatermarkModule,
    ProductMediaSyncModule,
    PublicationModule,
    ProductsModule,
    SpaModule, // luôn để cuối, xem SpaModule.ts
  ],
})
export class AppModule {}
