import { describe, expect, it, vi } from "vitest";
import { createProductWebhookHandlers } from "./ProductWebhookHandlers.ts";
import type { ReceiveProductWebhook } from "../application/ReceiveProductWebhook.ts";
import type { PrismaClient } from "../../../generated/prisma/client.ts";

describe("ProductWebhookHandlers", () => {
  it("handles APP_UNINSTALLED by marking shop uninstalled and deleting sessions", async () => {
    const mockReceiver = {} as ReceiveProductWebhook;

    const mockShopUpdate = vi.fn().mockResolvedValue({});
    const mockJobsUpdate = vi.fn().mockResolvedValue({});
    const mockTransaction = vi.fn().mockImplementation((actions) => Promise.all(actions));

    const mockPrisma = {
      shop: {
        findUnique: vi.fn().mockResolvedValue({ id: "shop-1" }),
        update: mockShopUpdate,
      },
      watermarkJob: {
        updateMany: mockJobsUpdate,
      },
      $transaction: mockTransaction,
    } as unknown as PrismaClient;

    const mockDeleteSessions = vi.fn().mockResolvedValue(true);
    const mockSessionStorage = {
      findSessionsByShop: vi.fn().mockResolvedValue([{ id: "offline_test.myshopify.com" }]),
      deleteSessions: mockDeleteSessions,
    };

    const handlers = createProductWebhookHandlers(
      mockReceiver,
      "2026-07",
      mockPrisma,
      mockSessionStorage,
    );

    expect(handlers.APP_UNINSTALLED).toBeDefined();

    // Call the callback
    await (handlers.APP_UNINSTALLED as any).callback(
      "APP_UNINSTALLED",
      "test.myshopify.com",
      JSON.stringify({ id: 12345 }),
      "wh-123",
      "2026-07",
    );

    expect(mockPrisma.shop.findUnique).toHaveBeenCalledWith({
      where: { domain: "test.myshopify.com" },
      select: { id: true },
    });
    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(mockDeleteSessions).toHaveBeenCalledWith(["offline_test.myshopify.com"]);
  });
});
