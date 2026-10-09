import { describe, expect, it } from "vitest";
import { EmailTakenError, InvalidCredentialsError, type Account } from "../domain/Account.ts";
import { detectImageType, UPLOADED_PRODUCT_PREFIX } from "../domain/UploadedImage.ts";
import { ScryptPasswordHasher } from "../infrastructure/ScryptPasswordHasher.ts";
import { RegisterAccount, SignIn } from "./StandaloneAccounts.ts";
import type { AccountRepository, UploadedProductCatalog } from "./StandalonePorts.ts";
import { RemoveImageProduct, UploadImageProduct } from "./UploadedImages.ts";

class InMemoryAccounts implements AccountRepository {
  readonly shops = new Map<string, string>();
  private readonly byEmail = new Map<string, Account>();

  async findByEmail(email: string) {
    return this.byEmail.get(email) ?? null;
  }
  async findById(id: string) {
    return [...this.byEmail.values()].find((account) => account.id === id) ?? null;
  }
  async create(account: Account, shopDomain: string) {
    if (this.byEmail.has(account.email)) throw new EmailTakenError();
    this.byEmail.set(account.email, account);
    this.shops.set(account.id, shopDomain);
  }
}

class InMemoryCatalog implements UploadedProductCatalog {
  readonly products = new Map<string, { shopDomain: string; title: string; productType: string; imageUrl: string }>();

  async add(shopDomain: string, product: { id: string; title: string; productType: string; imageUrl: string }) {
    this.products.set(product.id, { shopDomain, ...product });
  }
  async remove(shopDomain: string, productId: string) {
    const product = this.products.get(productId);
    if (!product || product.shopDomain !== shopDomain) return false;
    return this.products.delete(productId);
  }
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe("Tài khoản chế độ độc lập", () => {
  const hasher = new ScryptPasswordHasher();

  it("đăng ký tạo shop riêng và đăng nhập lại được", async () => {
    const accounts = new InMemoryAccounts();
    const account = await new RegisterAccount(accounts, hasher).execute({
      email: "  Shop@Example.COM ",
      password: "mat-khau-dai",
    });

    expect(account.email).toBe("shop@example.com");
    expect(account.passwordHash).not.toContain("mat-khau-dai");
    expect(accounts.shops.get(account.id)).toBe(`${account.id}.standalone.local`);

    const signedIn = await new SignIn(accounts, hasher).execute({
      email: "shop@example.com",
      password: "mat-khau-dai",
    });
    expect(signedIn.id).toBe(account.id);
  });

  it("từ chối email trùng, dữ liệu sai và mật khẩu sai", async () => {
    const accounts = new InMemoryAccounts();
    const register = new RegisterAccount(accounts, hasher);
    await register.execute({ email: "a@example.com", password: "12345678" });

    await expect(register.execute({ email: "A@example.com", password: "12345678" })).rejects.toBeInstanceOf(EmailTakenError);
    await expect(register.execute({ email: "khong-phai-email", password: "12345678" })).rejects.toThrow("Email không hợp lệ");
    await expect(register.execute({ email: "b@example.com", password: "ngan" })).rejects.toThrow("Mật khẩu phải dài");

    const signIn = new SignIn(accounts, hasher);
    await expect(signIn.execute({ email: "a@example.com", password: "sai-mat-khau" })).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(signIn.execute({ email: "chua@example.com", password: "12345678" })).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(signIn.execute({ email: 42, password: "12345678" })).rejects.toBeInstanceOf(InvalidCredentialsError);
  });
});

describe("Ảnh tải lên ở chế độ độc lập", () => {
  it("lưu ảnh và tạo sản phẩm trỏ tới media của shop", async () => {
    const stored: Array<{ shopDomain: string; mimeType: string }> = [];
    const images = {
      storeUploaded: async (shopDomain: string, _bytes: Buffer, mimeType: string) => {
        stored.push({ shopDomain, mimeType });
        return { id: "asset-1" };
      },
    };
    const catalog = new InMemoryCatalog();

    const product = await new UploadImageProduct(images, catalog).execute({
      shopDomain: "acc.standalone.local",
      bytes: PNG,
      title: "ao-thun   trang.png",
      productType: " Áo thun ",
    });

    expect(product.id.startsWith(UPLOADED_PRODUCT_PREFIX)).toBe(true);
    expect(product.title).toBe("ao-thun trang");
    expect(product.imageUrl).toBe("/api/media/assets/asset-1/content");
    expect(stored).toEqual([{ shopDomain: "acc.standalone.local", mimeType: "image/png" }]);
    expect(catalog.products.get(product.id)?.productType).toBe("Áo thun");
  });

  it("từ chối file không phải ảnh dù trình duyệt khai là ảnh", async () => {
    const upload = new UploadImageProduct({ storeUploaded: async () => ({ id: "x" }) }, new InMemoryCatalog());
    await expect(
      upload.execute({ shopDomain: "s", bytes: Buffer.from("<svg onload=alert(1)>"), title: "a.png", productType: "" }),
    ).rejects.toThrow("Chỉ hỗ trợ ảnh");
    await expect(upload.execute({ shopDomain: "s", bytes: Buffer.alloc(0), title: "", productType: "" })).rejects.toThrow("trống");
  });

  it("chỉ xóa ảnh tải lên của đúng shop", async () => {
    const catalog = new InMemoryCatalog();
    await catalog.add("a", { id: "upload-1", title: "t", productType: "", imageUrl: "/x" });
    const remove = new RemoveImageProduct(catalog);

    await expect(remove.execute("a", "gid://shopify/Product/1")).rejects.toThrow("Không tìm thấy");
    await expect(remove.execute("b", "upload-1")).rejects.toThrow("Không tìm thấy");
    await remove.execute("a", "upload-1");
    expect(catalog.products.size).toBe(0);
  });

  it("nhận diện định dạng ảnh theo magic bytes", () => {
    expect(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(detectImageType(PNG)).toBe("image/png");
    expect(detectImageType(Buffer.from("GIF89a......"))).toBe("image/gif");
    expect(detectImageType(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(detectImageType(Buffer.from("hello world!"))).toBeNull();
  });
});
