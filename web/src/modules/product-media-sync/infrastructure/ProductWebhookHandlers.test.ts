import "@shopify/shopify-api/adapters/node";
import {
  ApiVersion,
  DeliveryMethod,
  shopifyApi,
} from "@shopify/shopify-api";
import { describe, expect, it, vi } from "vitest";

describe("Shopify webhook HMAC boundary", () => {
  it("từ chối HMAC sai trước khi gọi product callback", async () => {
    const callback = vi.fn(async () => undefined);
    const api = shopifyApi({
      apiKey: "test-key",
      apiSecretKey: "test-secret",
      scopes: ["read_products", "write_products"],
      hostName: "example.com",
      hostScheme: "https",
      isEmbeddedApp: true,
      apiVersion: "2026-07" as ApiVersion,
    });
    api.webhooks.addHandlers({
      PRODUCTS_UPDATE: {
        deliveryMethod: DeliveryMethod.Http,
        callbackUrl: "/api/webhooks",
        callback,
      },
    });

    const response = new FakeResponse();
    await expect(
      api.webhooks.process({
        rawBody: JSON.stringify({ id: 1 }),
        rawRequest: {
          method: "POST",
          url: "/api/webhooks",
          headers: {
            "x-shopify-api-version": "2026-07",
            "x-shopify-hmac-sha256": "invalid",
            "x-shopify-shop-domain": "demo.myshopify.com",
            "x-shopify-topic": "products/update",
            "x-shopify-webhook-id": "webhook-invalid-hmac",
          },
        } as never,
        rawResponse: response as never,
      })
    ).rejects.toThrow();

    expect(callback).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(401);
  });
});

class FakeResponse {
  statusCode = 200;
  statusMessage = "";
  private readonly headers: Record<string, string | string[] | number> = {};

  getHeaders() {
    return this.headers;
  }

  setHeader(name: string, value: string | string[] | number) {
    this.headers[name] = value;
  }

  write(_body: string) {}

  end() {}
}
