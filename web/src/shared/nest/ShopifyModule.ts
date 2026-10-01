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
    // Mọi request /api phải có session hợp lệ; middleware gắn session vào
    // response.locals.shopify.session để decorator @ShopifySession() đọc ra.
    consumer
      .apply(shopify.validateAuthenticatedSession())
      .forRoutes({ path: "api/{*path}", method: RequestMethod.ALL });
  }
}
