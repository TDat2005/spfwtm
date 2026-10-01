import type { Response } from "express";
import type { Session } from "@shopify/shopify-api";

export interface ShopifyLocals extends Record<string, unknown> {
  shopify: { session: Session };
}

export type ShopifyResponse = Response<unknown, ShopifyLocals>;

export function routeError(
  response: ShopifyResponse,
  label: string,
  error: unknown,
  status = 500,
  publicMessage?: string,
): void {
  const message = error instanceof Error ? error.message : "Lỗi không xác định";
  console.error(`${label} error:`, message);
  response.status(status).send({ error: publicMessage ?? message });
}
