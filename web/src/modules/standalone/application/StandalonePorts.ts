import type { Account } from "../domain/Account.ts";

export interface AccountRepository {
  findByEmail(email: string): Promise<Account | null>;
  findById(id: string): Promise<Account | null>;
  /** Tạo tài khoản kèm Shop riêng; ném EmailTakenError nếu email đã tồn tại. */
  create(account: Account, shopDomain: string): Promise<void>;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, passwordHash: string): Promise<boolean>;
}

/** Lưu file ảnh; MediaService đáp ứng sẵn port này. */
export interface UploadedImageStore {
  storeUploaded(shopDomain: string, bytes: Buffer, mimeType: string): Promise<{ id: string }>;
}

export interface UploadedProductCatalog {
  add(
    shopDomain: string,
    product: { id: string; title: string; productType: string; imageUrl: string },
  ): Promise<void>;
  /** Ẩn sản phẩm (xóa mềm) để lịch sử watermark vẫn tham chiếu được. */
  remove(shopDomain: string, productId: string): Promise<boolean>;
}
