import { UnauthorizedException } from "@nestjs/common";
import type { Session } from "@shopify/shopify-api";
import type { Response } from "express";
import type { AppPlatform } from "../platform.ts";

/** Chủ sở hữu dữ liệu của request: một shop Shopify hoặc một tài khoản độc lập. */
export interface Tenant {
  /** Domain của bảng `shops`, khóa chung mọi module dùng để tách dữ liệu. */
  shop: string;
  platform: AppPlatform;
}

export interface TenantLocals extends Record<string, unknown> {
  tenant?: Tenant;
  shopify?: { session?: Session };
}

export function resolveTenant(response: Response<unknown, TenantLocals>): Tenant {
  const { tenant, shopify } = response.locals;
  if (tenant) return tenant;
  if (shopify?.session?.shop) return { shop: shopify.session.shop, platform: "shopify" };
  throw new UnauthorizedException({ error: "Chưa đăng nhập" });
}
