import express from "express";
import type { Request, Response } from "express";
import type { Session } from "@shopify/shopify-api";

import type { Product } from "../domain/Product.ts";
import type { ListProducts } from "../application/ListProducts.ts";
import type {
  SyncCatalog,
  SyncCatalogResult,
} from "../application/SyncCatalog.ts";

interface CatalogRouterDependencies {
  createListProducts(): ListProducts;
  createSyncCatalog(session: Session): SyncCatalog;
}

interface ShopifyLocals extends Record<string, unknown> {
  shopify: {
    session: Session;
  };
}

interface ListProductsResponse {
  products: Product[];
}

interface ErrorResponse {
  error: string;
}

type CatalogResponse =
  | ListProductsResponse
  | SyncCatalogResult
  | ErrorResponse;

export function createCatalogRouter({
  createListProducts,
  createSyncCatalog,
}: CatalogRouterDependencies) {
  const router = express.Router();

  router.get(
    "/products",
    async (
      _request: Request,
      response: Response<CatalogResponse, ShopifyLocals>,
    ) => {
      try {
        const session = response.locals.shopify.session;
        const useCase = createListProducts();
        const products = await useCase.execute(session.shop);

        response.status(200).send({ products });
      } catch (error: unknown) {
        sendError(response, error);
      }
    },
  );

  router.post(
    "/sync",
    async (
      _request: Request,
      response: Response<CatalogResponse, ShopifyLocals>,
    ) => {
      try {
        const session = response.locals.shopify.session;
        const useCase = createSyncCatalog(session);
        const result = await useCase.execute(session.shop);

        response.status(200).send(result);
      } catch (error: unknown) {
        sendError(response, error);
      }
    },
  );

  return router;
}

function sendError(
  response: Response<CatalogResponse, ShopifyLocals>,
  error: unknown,
): void {
  const message =
    error instanceof Error
      ? error.message
      : "Lỗi không xác định";

  console.error("Catalog error:", message);

  response.status(500).send({
    error: "Không xử lý được catalog",
  });
}