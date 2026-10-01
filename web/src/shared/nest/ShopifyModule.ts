import {
  Global,
  Module,
  RequestMethod,
  type MiddlewareConsumer,
  type NestModule,
} from "@nestjs/common";
import shopify from "../../../shopify.js";
import { SHOPIFY } from "./tokens.ts";

@Global()
@Module({
  providers: [{ provide: SHOPIFY, useValue: shopify }],
  exports: [SHOPIFY],
})
export class ShopifyModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(shopify.validateAuthenticatedSession())
      .forRoutes({ path: "api/{*path}", method: RequestMethod.ALL });
  }
}
