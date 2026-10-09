import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type {
  AccountRepository,
  UploadedProductCatalog,
} from "../application/StandalonePorts.ts";
import { EmailTakenError, type Account } from "../domain/Account.ts";

export class PrismaAccountRepository implements AccountRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByEmail(email: string): Promise<Account | null> {
    return await this.prisma.account.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true },
    });
  }

  async findById(id: string): Promise<Account | null> {
    return await this.prisma.account.findUnique({
      where: { id },
      select: { id: true, email: true, passwordHash: true },
    });
  }

  async create(account: Account, shopDomain: string): Promise<void> {
    try {
      await this.prisma.$transaction(async (transaction) => {
        const shop = await transaction.shop.upsert({
          where: { domain: shopDomain },
          create: { domain: shopDomain },
          update: {},
        });
        await transaction.account.create({
          data: { ...account, shopId: shop.id },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new EmailTakenError();
      throw error;
    }
  }
}

export class PrismaUploadedProductCatalog implements UploadedProductCatalog {
  constructor(private readonly prisma: PrismaClient) {}

  async add(
    shopDomain: string,
    product: { id: string; title: string; productType: string; imageUrl: string },
  ): Promise<void> {
    const shop = await this.prisma.shop.upsert({
      where: { domain: shopDomain },
      create: { domain: shopDomain },
      update: {},
    });
    await this.prisma.catalogProduct.create({
      data: {
        shopId: shop.id,
        // Cột lưu ID sản phẩm của nguồn; với ảnh tải lên là `upload-<uuid>`.
        shopifyProductId: product.id,
        title: product.title,
        status: "ACTIVE",
        productType: product.productType,
        imageUrl: product.imageUrl,
        originalImageUrl: product.imageUrl,
      },
    });
  }

  async remove(shopDomain: string, productId: string): Promise<boolean> {
    const result = await this.prisma.catalogProduct.updateMany({
      where: { shopifyProductId: productId, deletedAt: null, shop: { domain: shopDomain } },
      data: { deletedAt: new Date() },
    });
    return result.count > 0;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}
