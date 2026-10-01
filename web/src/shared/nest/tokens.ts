import type shopify from "../../../shopify.js";

/**
 * Injection token cho những thứ không phải class do mình viết.
 * Dùng: constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient)
 */
export const PRISMA_CLIENT = Symbol("PRISMA_CLIENT");
export const SHOPIFY = Symbol("SHOPIFY");

export type ShopifyApp = typeof shopify;
