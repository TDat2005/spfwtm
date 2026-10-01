import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Session } from "@shopify/shopify-api";
import type { Response } from "express";

interface ShopifyLocals extends Record<string, unknown> {
  shopify: { session: Session };
}

export const ShopifySession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Session => {
    const response = context.switchToHttp().getResponse<Response<unknown, ShopifyLocals>>();
    return response.locals.shopify.session;
  },
);
