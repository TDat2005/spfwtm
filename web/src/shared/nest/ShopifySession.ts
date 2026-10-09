import { createParamDecorator, ForbiddenException, type ExecutionContext } from "@nestjs/common";
import type { Session } from "@shopify/shopify-api";
import type { Response } from "express";
import type { TenantLocals } from "./Tenant.ts";

/**
 * Session Shopify của request. Route dùng decorator này chỉ chạy trong Shopify
 * Admin; gọi từ chế độ độc lập sẽ bị trả 403.
 */
export const ShopifySession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Session => {
    const response = context.switchToHttp().getResponse<Response<unknown, TenantLocals>>();
    const session = response.locals.shopify?.session;
    if (!session) {
      throw new ForbiddenException({ error: "Tính năng này chỉ dùng được khi mở app trong Shopify Admin" });
    }
    return session;
  },
);
