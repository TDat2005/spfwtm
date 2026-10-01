import { Module } from "@nestjs/common";
import { SpaController } from "./SpaController.ts";

@Module({ controllers: [SpaController] })
export class SpaModule {}
