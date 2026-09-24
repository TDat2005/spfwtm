import {
  DeliveryMethod,
  type HttpWebhookHandlerWithCallback,
  type WebhookHandlerFunction,
} from "@shopify/shopify-api";
import type { ReceiveProductWebhook } from "../application/ReceiveProductWebhook.ts";

export function createProductWebhookHandlers(
  receiver: ReceiveProductWebhook,
  fallbackApiVersion: string
) {
  const receiveProduct: WebhookHandlerFunction = async (
    topic,
    shopDomain,
    body,
    webhookId,
    apiVersion
  ) => {
    await receiver.execute({
      webhookId,
      shopDomain,
      topic,
      apiVersion: apiVersion ?? fallbackApiVersion,
      body,
    });
  };

  const productsUpdate: HttpWebhookHandlerWithCallback = {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/api/webhooks",
      callback: receiveProduct,
  };
  const productsDelete: HttpWebhookHandlerWithCallback = {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/api/webhooks",
      callback: receiveProduct,
  };
  const bulkOperationsFinish: HttpWebhookHandlerWithCallback = {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/api/webhooks",
      callback: async () => undefined,
  };

  return {
    PRODUCTS_UPDATE: productsUpdate,
    PRODUCTS_DELETE: productsDelete,
    BULK_OPERATIONS_FINISH: bulkOperationsFinish,
  };
}
