import { Controller, Get, Inject, Post, Res } from "@nestjs/common";
import type { ShopifyResponse } from "./ShopifyResponse.ts";
import { APP_DEPENDENCIES, type AppDependencies } from "./AppDependencies.ts";

@Controller("api/products")
export class ProductsController {
  constructor(@Inject(APP_DEPENDENCIES) private readonly dependencies: AppDependencies) {}

  @Get("count")
  async count(@Res() response: ShopifyResponse): Promise<void> {
    const count = await this.dependencies.countProducts(response.locals.shopify.session);
    response.status(200).send({ count });
  }

  @Post()
  async create(@Res() response: ShopifyResponse): Promise<void> {
    let error: string | null = null;
    try {
      await this.dependencies.createProduct(response.locals.shopify.session);
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
      console.log(`Failed to process products/create: ${error}`);
    }
    response.status(error ? 500 : 200).send({ success: error === null, error });
  }
}
