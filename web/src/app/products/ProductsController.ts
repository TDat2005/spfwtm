import {
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Post,
} from "@nestjs/common";
import type { Session } from "@shopify/shopify-api";
import { ShopifySession } from "../../shared/nest/ShopifySession.ts";
import { ProductsService } from "./ProductsService.ts";

@Controller("api/products")
export class ProductsController {
  private readonly logger = new Logger(ProductsController.name);

  constructor(@Inject(ProductsService) private readonly products: ProductsService) {}

  @Get("count")
  async count(@ShopifySession() session: Session) {
    return { count: await this.products.count(session) };
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async create(@ShopifySession() session: Session) {
    try {
      await this.products.createSampleProducts(session);
      return { success: true, error: null };
    } catch (failure) {
      const error = failure instanceof Error ? failure.message : String(failure);
      this.logger.error(`Failed to process products/create: ${error}`);
      throw new HttpException({ success: false, error }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
