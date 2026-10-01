import type shopify from "../../../shopify.js";

export const PRISMA_CLIENT = Symbol("PRISMA_CLIENT");
export const SHOPIFY = Symbol("SHOPIFY");

export type ShopifyApp = typeof shopify;
