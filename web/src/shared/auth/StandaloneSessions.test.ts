import type { Request, Response } from "express";
import { describe, expect, it } from "vitest";
import { isSameOriginRequest, StandaloneSessions } from "./StandaloneSessions.ts";

const ACCOUNT_ID = "6f1c2c1e-3b8a-4c62-9a57-0d7f4f2b9e11";

function issueCookie(sessions: StandaloneSessions, headers: Record<string, string> = {}): string {
  const cookies: string[] = [];
  const response = { append: (_name: string, value: string) => cookies.push(value) } as unknown as Response;
  sessions.issue({ protocol: "http", headers } as unknown as Request, response, ACCOUNT_ID);
  return cookies[0] ?? "";
}

function requestWith(cookie: string): Request {
  return { headers: { cookie: cookie.split(";")[0] } } as unknown as Request;
}

describe("StandaloneSessions", () => {
  it("đọc lại được session vừa cấp", () => {
    const sessions = new StandaloneSessions(() => "secret");
    const cookie = issueCookie(sessions);

    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Secure");
    expect(sessions.read(requestWith(cookie))?.accountId).toBe(ACCOUNT_ID);
  });

  it("gắn Secure khi chạy sau proxy HTTPS", () => {
    const cookie = issueCookie(new StandaloneSessions(() => "secret"), { "x-forwarded-proto": "https" });
    expect(cookie).toContain("Secure");
  });

  it("từ chối token bị sửa, sai secret hoặc hết hạn", () => {
    let now = Date.UTC(2026, 9, 7);
    const sessions = new StandaloneSessions(() => "secret", () => now);
    const cookie = issueCookie(sessions);
    const token = cookie.split(";")[0]!.split("=")[1]!;

    const otherAccount = token.replace(ACCOUNT_ID, "00000000-0000-4000-8000-000000000000");
    expect(sessions.verify(otherAccount)).toBeNull();
    expect(new StandaloneSessions(() => "other", () => now).verify(token)).toBeNull();
    expect(new StandaloneSessions(() => undefined, () => now).verify(token)).toBeNull();

    now += 31 * 24 * 60 * 60 * 1000;
    expect(sessions.verify(token)).toBeNull();
  });

  it("không cấp session khi chưa cấu hình secret", () => {
    expect(() => issueCookie(new StandaloneSessions(() => undefined))).toThrow("STANDALONE_SESSION_SECRET");
  });
});

describe("isSameOriginRequest", () => {
  const request = (headers: Record<string, string>) => ({ headers }) as unknown as Request;

  it("chấp nhận request cùng host hoặc không có Origin", () => {
    expect(isSameOriginRequest(request({ host: "app.test" }))).toBe(true);
    expect(isSameOriginRequest(request({ host: "app.test", origin: "https://app.test" }))).toBe(true);
    expect(
      isSameOriginRequest(request({ host: "127.0.0.1:3000", "x-forwarded-host": "app.test", origin: "https://app.test" })),
    ).toBe(true);
  });

  it("chặn request từ trang khác", () => {
    expect(isSameOriginRequest(request({ host: "app.test", origin: "https://evil.test" }))).toBe(false);
    expect(isSameOriginRequest(request({ host: "app.test", origin: "null" }))).toBe(false);
  });
});
