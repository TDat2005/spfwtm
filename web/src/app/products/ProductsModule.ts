import { Module } from "@nestjs/common";
import { ProductsController } from "./ProductsController.ts";
import { ProductsService } from "./ProductsService.ts";

@Module({
  controllers: [ProductsController],
  providers: [ProductsService],
})
export class ProductsModule {}
