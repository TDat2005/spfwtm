import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";

const COOKIE_NAME = "wm_session";
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const TOKEN_PATTERN = /^([0-9a-f-]{36})\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/;

export interface StandaloneSession {
  accountId: string;
  expiresAt: number;
}

/**
 * Session của chế độ độc lập: cookie HttpOnly chứa `accountId.hết-hạn.chữ-ký`
 * ký HMAC-SHA256, không cần lưu session trong DB.
 */
export class StandaloneSessions {
  constructor(
    private readonly secret: () => string | undefined = defaultSecret,
    private readonly now: () => number = Date.now,
  ) {}

  read(request: Request): StandaloneSession | null {
    const token = readCookie(request.headers.cookie, COOKIE_NAME);
    return token ? this.verify(token) : null;
  }

  issue(request: Request, response: Response, accountId: string): void {
    const secret = this.secret();
    if (!secret) {
      throw new Error("Chưa cấu hình STANDALONE_SESSION_SECRET cho chế độ độc lập");
    }
    const expiresAt = Math.floor(this.now() / 1000) + MAX_AGE_SECONDS;
    const payload = `${accountId}.${expiresAt}`;
    const token = `${payload}.${sign(secret, payload)}`;
    response.append("Set-Cookie", serializeCookie(token, MAX_AGE_SECONDS, isHttps(request)));
  }

  clear(request: Request, response: Response): void {
    response.append("Set-Cookie", serializeCookie("", 0, isHttps(request)));
  }

  verify(token: string): StandaloneSession | null {
    const secret = this.secret();
    const match = TOKEN_PATTERN.exec(token);
    if (!secret || !match?.[1] || !match[2] || !match[3]) return null;
    const expected = Buffer.from(sign(secret, `${match[1]}.${match[2]}`));
    const actual = Buffer.from(match[3]);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const expiresAt = Number(match[2]);
    if (expiresAt * 1000 <= this.now()) return null;
    return { accountId: match[1], expiresAt };
  }
}

function sign(secret: string, payload: string): string {
  // Tiền tố tách mục đích sử dụng khi phải dùng chung SHOPIFY_API_SECRET.
  return createHmac("sha256", secret).update(`standalone-session:${payload}`).digest("base64url");
}

/**
 * Request ghi (POST/PATCH/DELETE) bằng cookie phải đến từ chính trang của app.
 * Cookie đã là SameSite=Lax, đây là lớp chống CSRF bổ sung.
 */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  const host = firstHeader(request.headers["x-forwarded-host"]) ?? request.headers.host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function defaultSecret(): string | undefined {
  return process.env.STANDALONE_SESSION_SECRET || process.env.SHOPIFY_API_SECRET || undefined;
}

function isHttps(request: Request): boolean {
  return request.protocol === "https" || firstHeader(request.headers["x-forwarded-proto"]) === "https";
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.split(",")[0]?.trim() || undefined;
}

function serializeCookie(value: string, maxAge: number, secure: boolean): string {
  const parts = [
    `${COOKIE_NAME}=${value}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim() || null;
  }
  return null;
}
