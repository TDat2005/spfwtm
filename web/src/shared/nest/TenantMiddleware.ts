import type { RequestHandler } from "express";
import { isSameOriginRequest, type StandaloneSessions } from "../auth/StandaloneSessions.ts";
import { standaloneEnabled, standaloneShopDomain } from "../platform.ts";
import type { Tenant } from "./Tenant.ts";
import type { ShopifyApp } from "./tokens.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Xác thực mọi route `/api/*` cho cả hai chế độ:
 * - Có `Authorization: Bearer` (App Bridge tự gắn) hoặc `?shop=` → luồng Shopify như cũ.
 * - Ngược lại → cookie session của tài khoản độc lập.
 */
export function createTenantMiddleware(
  shopify: ShopifyApp,
  sessions: StandaloneSessions,
): RequestHandler {
  const validateShopify = shopify.validateAuthenticatedSession();

  return (request, response, next) => {
    const fromShopify = Boolean(request.headers.authorization) || typeof request.query.shop === "string";
    if (fromShopify || !standaloneEnabled()) {
      return validateShopify(request, response, next);
    }

    const session = sessions.read(request);
    if (!session) {
      response.status(401).json({ error: "Chưa đăng nhập" });
      return;
    }
    if (!SAFE_METHODS.has(request.method) && !isSameOriginRequest(request)) {
      response.status(403).json({ error: "Request không cùng nguồn gốc với app" });
      return;
    }
    const tenant: Tenant = { shop: standaloneShopDomain(session.accountId), platform: "standalone" };
    response.locals.tenant = tenant;
    next();
  };
}
