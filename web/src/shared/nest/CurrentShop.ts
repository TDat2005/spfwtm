import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Response } from "express";
import { resolveTenant, type TenantLocals } from "./Tenant.ts";

/** Domain shop của request, dùng cho route chạy được ở cả Shopify lẫn chế độ độc lập. */
export const CurrentShop = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const response = context.switchToHttp().getResponse<Response<unknown, TenantLocals>>();
    return resolveTenant(response).shop;
  },
);
