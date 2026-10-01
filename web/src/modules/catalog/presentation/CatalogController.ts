import { Controller, Get, Inject, Post, Res } from "@nestjs/common";
import { APP_DEPENDENCIES, type AppDependencies } from "../../../app/AppDependencies.ts";
import { routeError, type ShopifyResponse } from "../../../app/ShopifyResponse.ts";

@Controller("api/catalog")
export class CatalogController {
  constructor(@Inject(APP_DEPENDENCIES) private readonly dependencies: AppDependencies) {}

  @Get("products")
  async list(@Res() response: ShopifyResponse): Promise<void> {
    try {
      const session = response.locals.shopify.session;
      const products = await this.dependencies.createListProducts().execute(session.shop);
      response.status(200).send({ products });
    } catch (error) {
      routeError(response, "Catalog", error, 500, "Không xử lý được catalog");
    }
  }

  @Post("sync")
  async sync(@Res() response: ShopifyResponse): Promise<void> {
    try {
      const session = response.locals.shopify.session;
      const result = await this.dependencies.createSyncCatalog(session).execute(session.shop);
      response.status(200).send(result);
    } catch (error) {
      routeError(response, "Catalog", error, 500, "Không xử lý được catalog");
    }
  }
}
