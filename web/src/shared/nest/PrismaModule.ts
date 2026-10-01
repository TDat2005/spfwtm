import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { createPrismaClient } from "../infrastructure/prisma.ts";
import { PRISMA_CLIENT } from "./tokens.ts";

/** @Global: mọi module đều inject được PRISMA_CLIENT mà không cần import PrismaModule. */
@Global()
@Module({
  providers: [{ provide: PRISMA_CLIENT, useFactory: createPrismaClient }],
  exports: [PRISMA_CLIENT],
})
export class PrismaModule implements OnApplicationShutdown {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async onApplicationShutdown(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
