import { Module } from "@nestjs/common";
import { AutoWatermarkModule } from "../modules/auto-watermark/AutoWatermarkModule.ts";
import { CatalogModule } from "../modules/catalog/CatalogModule.ts";
import { JobsModule } from "../modules/jobs/JobsModule.ts";
import { MediaModule } from "../modules/media/MediaModule.ts";
import { ProductMediaSyncModule } from "../modules/product-media-sync/ProductMediaSyncModule.ts";
import { PublicationModule } from "../modules/shopify-publication/PublicationModule.ts";
import { StandaloneModule } from "../modules/standalone/StandaloneModule.ts";
import { WatermarkModule } from "../modules/watermark/WatermarkModule.ts";
import { PrismaModule } from "../shared/nest/PrismaModule.ts";
import { ShopifyModule } from "../shared/nest/ShopifyModule.ts";
import { TenantModule } from "../shared/nest/TenantModule.ts";
import { ProductsModule } from "./products/ProductsModule.ts";
import { SpaModule } from "./SpaModule.ts";

@Module({
  imports: [
    PrismaModule,
    ShopifyModule,
    TenantModule,
    JobsModule,
    CatalogModule,
    MediaModule,
    WatermarkModule,
    AutoWatermarkModule,
    ProductMediaSyncModule,
    PublicationModule,
    StandaloneModule,
    ProductsModule,
    SpaModule,
  ],
})
export class AppModule {}
