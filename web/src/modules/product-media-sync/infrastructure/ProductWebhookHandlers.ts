import {
  DeliveryMethod,
  type HttpWebhookHandlerWithCallback,
  type WebhookHandlerFunction,
} from "@shopify/shopify-api";
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { ReceiveProductWebhook } from "../application/ReceiveProductWebhook.ts";

export function createProductWebhookHandlers(
  receiver: ReceiveProductWebhook,
  fallbackApiVersion: string,
  prisma?: PrismaClient,
  sessionStorage?: any,
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

  const appUninstalled: HttpWebhookHandlerWithCallback = {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks",
    callback: async (_topic, shopDomain) => {
      if (prisma) {
        try {
          const shop = await prisma.shop.findUnique({
            where: { domain: shopDomain },
            select: { id: true },
          });
          if (shop) {
            await prisma.$transaction([
              prisma.shop.update({
                where: { id: shop.id },
                data: {
                  uninstalledAt: new Date(),
                  catalogSyncStatus: "IDLE",
                  autoWatermarkEnabled: false,
                },
              }),
              prisma.watermarkJob.updateMany({
                where: {
                  shopId: shop.id,
                  status: { in: ["PENDING", "PROCESSING"] },
                },
                data: { status: "CANCELLED" },
              }),
            ]);
          }
        } catch (err) {
          console.error(`[Webhook APP_UNINSTALLED] Lỗi cập nhật DB cho shop ${shopDomain}:`, err);
        }
      }

      if (sessionStorage?.findSessionsByShop && sessionStorage?.deleteSessions) {
        try {
          const sessions = await sessionStorage.findSessionsByShop(shopDomain);
          if (sessions && sessions.length > 0) {
            const sessionIds = sessions.map((s: { id: string }) => s.id);
            await sessionStorage.deleteSessions(sessionIds);
          }
        } catch (err) {
          console.error(`[Webhook APP_UNINSTALLED] Lỗi xoá session cho shop ${shopDomain}:`, err);
        }
      }
    },
  };

  return {
    PRODUCTS_UPDATE: productsUpdate,
    PRODUCTS_DELETE: productsDelete,
    BULK_OPERATIONS_FINISH: bulkOperationsFinish,
    APP_UNINSTALLED: appUninstalled,
  };
}
