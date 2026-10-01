import { Module } from "@nestjs/common";
import { SpaController } from "./SpaController.ts";

/**
 * Tách riêng để AppModule import nó CUỐI CÙNG. Nest đăng ký route theo thứ tự
 * module được quét, nên route bắt-tất-cả "{*path}" phải đứng sau mọi route /api.
 */
@Module({ controllers: [SpaController] })
export class SpaModule {}
