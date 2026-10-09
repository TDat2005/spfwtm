import { Global, Module } from "@nestjs/common";
import shopify from "../../../shopify.js";
import { SHOPIFY } from "./tokens.ts";

@Global()
@Module({
  providers: [{ provide: SHOPIFY, useValue: shopify }],
  exports: [SHOPIFY],
})
export class ShopifyModule {}
