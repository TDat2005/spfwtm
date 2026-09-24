import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type {
  ProductReconcileQueue,
  WebhookInboxWriter,
} from "./ReceiveProductWebhook.ts";
import { ReceiveProductWebhook } from "./ReceiveProductWebhook.ts";

describe("ReceiveProductWebhook", () => {
  it("ba delivery trùng chỉ enqueue đúng một reconcile job", async () => {
    let recorded = false;
    const inbox: WebhookInboxWriter = {
      recordDelivery: vi.fn(async () => {
        if (recorded) return { inboxId: "inbox-1", shouldEnqueue: false };
        recorded = true;
        return { inboxId: "inbox-1", shouldEnqueue: true };
      }),
      markEnqueued: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => undefined),
    };
    const queue: ProductReconcileQueue = {
      enqueue: vi.fn(async () => undefined),
    };
    const receiver = new ReceiveProductWebhook(inbox, queue, 4_000);
    const delivery = {
      webhookId: "webhook-1",
      shopDomain: "demo.myshopify.com",
      topic: "PRODUCTS_UPDATE",
      apiVersion: "2026-07",
      body: readFileSync(
        new URL("../fixtures/products-update.2026-07.json", import.meta.url),
        "utf8"
      ),
    };

    await receiver.execute(delivery);
    await receiver.execute(delivery);
    await receiver.execute(delivery);

    expect(queue.enqueue).toHaveBeenCalledOnce();
    expect(queue.enqueue).toHaveBeenCalledWith({
      webhookId: "webhook-1",
      shopDomain: "demo.myshopify.com",
      delayMs: 4_000,
    });
  });
});
