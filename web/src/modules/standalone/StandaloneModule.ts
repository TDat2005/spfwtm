import { Module } from "@nestjs/common";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { PRISMA_CLIENT } from "../../shared/nest/tokens.ts";
import { MediaService } from "../media/application/MediaService.ts";
import { MediaModule } from "../media/MediaModule.ts";
import { RegisterAccount, SignIn } from "./application/StandaloneAccounts.ts";
import type { AccountRepository } from "./application/StandalonePorts.ts";
import { RemoveImageProduct, UploadImageProduct } from "./application/UploadedImages.ts";
import {
  PrismaAccountRepository,
  PrismaUploadedProductCatalog,
} from "./infrastructure/PrismaStandaloneAdapters.ts";
import { ScryptPasswordHasher } from "./infrastructure/ScryptPasswordHasher.ts";
import { StandaloneAuthController } from "./presentation/StandaloneAuthController.ts";
import { StandaloneImagesController } from "./presentation/StandaloneImagesController.ts";
import { ACCOUNT_REPOSITORY } from "./tokens.ts";

/** Chế độ độc lập: tài khoản email/mật khẩu và ảnh tải lên thay cho catalog Shopify. */
@Module({
  imports: [MediaModule],
  controllers: [StandaloneAuthController, StandaloneImagesController],
  providers: [
    {
      provide: ACCOUNT_REPOSITORY,
      inject: [PRISMA_CLIENT],
      useFactory: (prisma: PrismaClient) => new PrismaAccountRepository(prisma),
    },
    {
      provide: RegisterAccount,
      inject: [ACCOUNT_REPOSITORY],
      useFactory: (accounts: AccountRepository) =>
        new RegisterAccount(accounts, new ScryptPasswordHasher()),
    },
    {
      provide: SignIn,
      inject: [ACCOUNT_REPOSITORY],
      useFactory: (accounts: AccountRepository) => new SignIn(accounts, new ScryptPasswordHasher()),
    },
    {
      provide: UploadImageProduct,
      inject: [MediaService, PRISMA_CLIENT],
      useFactory: (media: MediaService, prisma: PrismaClient) =>
        new UploadImageProduct(media, new PrismaUploadedProductCatalog(prisma)),
    },
    {
      provide: RemoveImageProduct,
      inject: [PRISMA_CLIENT],
      useFactory: (prisma: PrismaClient) =>
        new RemoveImageProduct(new PrismaUploadedProductCatalog(prisma)),
    },
  ],
})
export class StandaloneModule {}
