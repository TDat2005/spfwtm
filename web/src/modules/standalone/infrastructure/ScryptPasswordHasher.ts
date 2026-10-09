import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import type { PasswordHasher } from "../application/StandalonePorts.ts";

const KEY_LENGTH = 64;
const PARAMS = { N: 16_384, r: 8, p: 1 } as const;

/** Lưu dạng `scrypt$N$r$p$salt$hash` để sau này đổi tham số vẫn kiểm tra được hash cũ. */
export class ScryptPasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const key = await derive(password, salt, PARAMS);
    return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64"), key.toString("base64")].join("$");
  }

  async verify(password: string, passwordHash: string): Promise<boolean> {
    const [scheme, n, r, p, salt, expected] = passwordHash.split("$");
    if (scheme !== "scrypt" || !salt || !expected) return false;
    const expectedKey = Buffer.from(expected, "base64");
    const key = await derive(password, Buffer.from(salt, "base64"), {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return key.length === expectedKey.length && timingSafeEqual(key, expectedKey);
  }
}

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}
