import { Module, type DynamicModule } from "@nestjs/common";
import { APP_DEPENDENCIES, type AppDependencies } from "./AppDependencies.ts";
import { CatalogController } from "../modules/catalog/presentation/CatalogController.ts";
import { MediaController } from "../modules/media/presentation/MediaController.ts";
import { WatermarkController } from "../modules/watermark/presentation/WatermarkController.ts";
import { PublicationController } from "../modules/shopify-publication/presentation/PublicationController.ts";
import { ProductsController } from "./ProductsController.ts";
import { SpaController } from "./SpaController.ts";

@Module({})
export class AppModule {
  static register(dependencies: AppDependencies): DynamicModule {
    return {
      module: AppModule,
      providers: [{ provide: APP_DEPENDENCIES, useValue: dependencies }],
      controllers: [
        CatalogController,
        MediaController,
        WatermarkController,
        PublicationController,
        ProductsController,
        SpaController,
      ],
    };
  }
}
