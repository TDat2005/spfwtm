import { randomUUID } from "node:crypto";
import { standaloneShopDomain } from "../../../shared/platform.ts";
import {
  assertPassword,
  InvalidCredentialsError,
  normalizeEmail,
  type Account,
} from "../domain/Account.ts";
import type { AccountRepository, PasswordHasher } from "./StandalonePorts.ts";

export class RegisterAccount {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly hasher: PasswordHasher,
  ) {}

  async execute(input: { email: unknown; password: unknown }): Promise<Account> {
    const email = normalizeEmail(input.email);
    const password = assertPassword(input.password);
    const account: Account = {
      id: randomUUID(),
      email,
      passwordHash: await this.hasher.hash(password),
    };
    await this.accounts.create(account, standaloneShopDomain(account.id));
    return account;
  }
}

export class SignIn {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly hasher: PasswordHasher,
  ) {}

  async execute(input: { email: unknown; password: unknown }): Promise<Account> {
    const password = typeof input.password === "string" ? input.password : "";
    let account: Account | null = null;
    try {
      account = await this.accounts.findByEmail(normalizeEmail(input.email));
    } catch {
      throw new InvalidCredentialsError();
    }
    if (!account) {
      // Vẫn băm để thời gian phản hồi không cho biết email nào đã đăng ký.
      await this.hasher.hash(password);
      throw new InvalidCredentialsError();
    }
    if (!(await this.hasher.verify(password, account.passwordHash))) {
      throw new InvalidCredentialsError();
    }
    return account;
  }
}
