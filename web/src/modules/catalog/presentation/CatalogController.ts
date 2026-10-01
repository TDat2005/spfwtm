import { Controller, Get, HttpCode, HttpStatus, Inject, Post } from "@nestjs/common";
import type { Session } from "@shopify/shopify-api";
import { ShopifySession } from "../../../shared/nest/ShopifySession.ts";
import { toHttpException } from "../../../shared/nest/toHttpException.ts";
import { GetCatalogSyncStatus } from "../application/GetCatalogSyncStatus.ts";
import { ListProducts } from "../application/ListProducts.ts";
import { ListProductTypes } from "../application/ListProductTypes.ts";
import { StartCatalogSync } from "../application/StartCatalogSync.ts";

@Controller("api/catalog")
export class CatalogController {
  constructor(
    @Inject(ListProducts) private readonly listProducts: ListProducts,
    @Inject(ListProductTypes) private readonly listProductTypes: ListProductTypes,
    @Inject(StartCatalogSync) private readonly startCatalogSync: StartCatalogSync,
    @Inject(GetCatalogSyncStatus) private readonly getCatalogSyncStatus: GetCatalogSyncStatus,
  ) {}

  @Get("products")
  async list(@ShopifySession() session: Session) {
    try {
      const products = await this.listProducts.execute(session.shop);
      return { products };
    } catch (error) {
      throw toHttpException("Catalog", error, HttpStatus.INTERNAL_SERVER_ERROR, "Không xử lý được catalog");
    }
  }

  @Get("product-types")
  async productTypes(@ShopifySession() session: Session) {
    try {
      const productTypes = await this.listProductTypes.execute(session.shop);
      return { productTypes };
    } catch (error) {
      throw toHttpException("Catalog", error, HttpStatus.INTERNAL_SERVER_ERROR, "Không xử lý được catalog");
    }
  }

  @Post("sync")
  @HttpCode(HttpStatus.ACCEPTED)
  async sync(@ShopifySession() session: Session) {
    try {
      return await this.startCatalogSync.execute(session.shop);
    } catch (error) {
      throw toHttpException("Catalog", error, HttpStatus.INTERNAL_SERVER_ERROR, "Không xử lý được catalog");
    }
  }

  @Get("sync")
  async syncStatus(@ShopifySession() session: Session) {
    try {
      return await this.getCatalogSyncStatus.execute(session.shop);
    } catch (error) {
      throw toHttpException("Catalog", error, HttpStatus.INTERNAL_SERVER_ERROR, "Không xử lý được catalog");
    }
  }
}
