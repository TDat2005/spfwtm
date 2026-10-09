import { describe, expect, it, vi } from "vitest";
import {
  RecoverMediaSync,
  STALE_INBOX_AFTER_MS,
  STALE_PUBLICATION_AFTER_MS,
  type StalledInboxProduct,
} from "./RecoverMediaSync.ts";

const NOW = new Date("2026-10-09T10:00:00Z");

function setup(stalled: StalledInboxProduct[], queued: string[] = []) {
  const inbox = {
    listStalledProducts: vi.fn(async () => stalled),
    releaseStalled: vi.fn(async () => undefined),
  };
  const publications = { failStale: vi.fn(async () => 4) };
  const queue = {
    enqueue: vi.fn(async () => undefined),
    isQueued: vi.fn(async (_shop: string, productId: string) => queued.includes(productId)),
  };
  const recover = new RecoverMediaSync(inbox, publications, queue, () => NOW);
  return { recover, inbox, publications, queue };
}

describe("RecoverMediaSync", () => {
  it("đưa lại webhook bị kẹt khi không còn job reconcile nào trong queue", async () => {
    const { recover, inbox, queue } = setup([
      { shopDomain: "a.myshopify.com", productId: "gid://shopify/Product/1", webhookId: "wh-2" },
    ]);

    const result = await recover.execute();

    const staleBefore = new Date(NOW.getTime() - STALE_INBOX_AFTER_MS);
    expect(inbox.listStalledProducts).toHaveBeenCalledWith(staleBefore, 200);
    expect(inbox.releaseStalled).toHaveBeenCalledWith(
      "a.myshopify.com",
      "gid://shopify/Product/1",
      staleBefore,
    );
    expect(queue.enqueue).toHaveBeenCalledWith({
      webhookId: "wh-2",
      shopDomain: "a.myshopify.com",
      productId: "gid://shopify/Product/1",
      delayMs: 0,
    });
    expect(result.requeuedProducts).toBe(1);
  });

  it("bỏ qua sản phẩm còn job reconcile đang chờ hoặc đang chạy", async () => {
    const { recover, inbox, queue } = setup(
      [{ shopDomain: "a.myshopify.com", productId: "p-1", webhookId: "wh-1" }],
      ["p-1"],
    );

    expect((await recover.execute()).requeuedProducts).toBe(0);
    expect(inbox.releaseStalled).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("đánh FAILED lượt publish đứng PUBLISHING quá 30 phút", async () => {
    const { recover, publications } = setup([]);

    expect((await recover.execute()).failedPublications).toBe(4);
    expect(publications.failStale).toHaveBeenCalledWith(
      new Date(NOW.getTime() - STALE_PUBLICATION_AFTER_MS),
    );
  });
});
