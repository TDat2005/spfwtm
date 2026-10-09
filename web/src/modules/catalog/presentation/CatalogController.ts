import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  Query,
} from "@nestjs/common";
import type { Session } from "@shopify/shopify-api";
import { CurrentShop } from "../../../shared/nest/CurrentShop.ts";
import { ShopifySession } from "../../../shared/nest/ShopifySession.ts";
import { toHttpException } from "../../../shared/nest/toHttpException.ts";
import { isCollectionGid, type ShopCollectionsFactory } from "../application/CollectionGateway.ts";
import { GetCatalogSyncStatus } from "../application/GetCatalogSyncStatus.ts";
import { ListProducts } from "../application/ListProducts.ts";
import { ListProductTypes } from "../application/ListProductTypes.ts";
import { StartCatalogSync } from "../application/StartCatalogSync.ts";
import { SHOP_COLLECTIONS } from "../tokens.ts";

@Controller("api/catalog")
export class CatalogController {
  constructor(
    @Inject(ListProducts) private readonly listProducts: ListProducts,
    @Inject(ListProductTypes) private readonly listProductTypes: ListProductTypes,
    @Inject(StartCatalogSync) private readonly startCatalogSync: StartCatalogSync,
    @Inject(GetCatalogSyncStatus) private readonly getCatalogSyncStatus: GetCatalogSyncStatus,
    @Inject(SHOP_COLLECTIONS) private readonly collections: ShopCollectionsFactory,
  ) {}

  @Get("products")
  async list(@CurrentShop() shopDomain: string) {
    try {
      const products = await this.listProducts.execute(shopDomain);
      return { products };
    } catch (error) {
      throw toHttpException("Catalog", error, HttpStatus.INTERNAL_SERVER_ERROR, "Không xử lý được catalog");
    }
  }

  @Get("product-types")
  async productTypes(@CurrentShop() shopDomain: string) {
    try {
      const productTypes = await this.listProductTypes.execute(shopDomain);
      return { productTypes };
    } catch (error) {
      throw toHttpException("Catalog", error, HttpStatus.INTERNAL_SERVER_ERROR, "Không xử lý được catalog");
    }
  }

  /** Collection chỉ có trên Shopify: chế độ độc lập bị ShopifySession trả 403. */
  @Get("collections")
  async searchCollections(@Query("query") query: unknown, @ShopifySession() session: Session) {
    try {
      const collections = await this.collections.forShop(session.shop);
      return { collections: await collections.search(typeof query === "string" ? query : "") };
    } catch (error) {
      throw toHttpException("Catalog", error, HttpStatus.INTERNAL_SERVER_ERROR, "Không tải được collection");
    }
  }

  /** GID sản phẩm (trùng `id` của /products) đang nằm trong collection, hỏi trực tiếp Shopify. */
  @Get("collection-products")
  async collectionProducts(
    @Query("collectionId") collectionId: unknown,
    @ShopifySession() session: Session,
  ) {
    if (typeof collectionId !== "string" || !isCollectionGid(collectionId)) {
      throw new BadRequestException({ error: "Collection không hợp lệ" });
    }
    let productIds: string[] | null;
    try {
      const collections = await this.collections.forShop(session.shop);
      productIds = await collections.listProductIds(collectionId);
    } catch (error) {
      throw toHttpException("Catalog", error, HttpStatus.INTERNAL_SERVER_ERROR, "Không tải được collection");
    }
    if (productIds === null) {
      throw new NotFoundException({ error: "Không tìm thấy collection trên Shopify" });
    }
    return { productIds };
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
