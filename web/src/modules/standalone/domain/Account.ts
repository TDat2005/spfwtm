export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;
const MAX_EMAIL_LENGTH = 255;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface Account {
  id: string;
  email: string;
  passwordHash: string;
}

export class InvalidAccountInputError extends Error {}

export class EmailTakenError extends Error {
  constructor() {
    super("Email này đã được đăng ký");
  }
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Email hoặc mật khẩu không đúng");
  }
}

export function normalizeEmail(raw: unknown): string {
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    throw new InvalidAccountInputError("Email không hợp lệ");
  }
  return email;
}

export function assertPassword(raw: unknown): string {
  if (
    typeof raw !== "string" ||
    raw.length < MIN_PASSWORD_LENGTH ||
    raw.length > MAX_PASSWORD_LENGTH
  ) {
    throw new InvalidAccountInputError(
      `Mật khẩu phải dài từ ${MIN_PASSWORD_LENGTH} đến ${MAX_PASSWORD_LENGTH} ký tự`,
    );
  }
  return raw;
}
