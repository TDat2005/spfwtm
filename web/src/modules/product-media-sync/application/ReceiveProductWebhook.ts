export interface RecordWebhookDeliveryInput {
  webhookId: string;
  eventId: string | null;
  shopDomain: string;
  topic: string;
  apiVersion: string;
  triggeredAt: Date;
  productId: string;
  payload: string;
}

export interface RecordWebhookDeliveryResult {
  inboxId: string;
  shouldEnqueue: boolean;
}

export interface WebhookInboxWriter {
  recordDelivery(
    input: RecordWebhookDeliveryInput
  ): Promise<RecordWebhookDeliveryResult>;
  markEnqueued(inboxId: string): Promise<void>;
  markFailed(inboxId: string, message: string): Promise<void>;
}

export interface ProductReconcileQueue {
  enqueue(input: {
    webhookId: string;
    shopDomain: string;
    delayMs: number;
  }): Promise<void>;
}

export interface ReceiveProductWebhookInput {
  webhookId: string;
  shopDomain: string;
  topic: string;
  apiVersion: string;
  body: string;
}

export interface ReceiveProductWebhookResult {
  accepted: boolean;
  duplicate: boolean;
}

export class ReceiveProductWebhook {
  constructor(
    private readonly inbox: WebhookInboxWriter,
    private readonly reconcileQueue: ProductReconcileQueue,
    private readonly debounceMs = 4_000
  ) {}

  async execute(
    input: ReceiveProductWebhookInput
  ): Promise<ReceiveProductWebhookResult> {
    const payload = parsePayload(input.body);
    const productId = productGid(payload);
    const delivery = await this.inbox.recordDelivery({
      webhookId: required(input.webhookId, "webhookId"),
      eventId: optionalString(payload.event_id),
      shopDomain: required(input.shopDomain, "shopDomain"),
      topic: required(input.topic, "topic"),
      apiVersion: required(input.apiVersion, "apiVersion"),
      triggeredAt: parseTriggeredAt(payload.updated_at),
      productId,
      payload: input.body,
    });

    if (!delivery.shouldEnqueue) {
      return { accepted: true, duplicate: true };
    }

    try {
      await this.reconcileQueue.enqueue({
        webhookId: input.webhookId,
        shopDomain: input.shopDomain,
        delayMs: this.debounceMs,
      });
      await this.inbox.markEnqueued(delivery.inboxId);
      return { accepted: true, duplicate: false };
    } catch (error) {
      await this.inbox.markFailed(delivery.inboxId, errorMessage(error));
      throw error;
    }
  }
}

function parsePayload(body: string): Record<string, unknown> {
  try {
    const value = JSON.parse(body) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("payload phải là JSON object");
    }
    return value as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Webhook product không hợp lệ: ${errorMessage(error)}`);
  }
}

function productGid(payload: Record<string, unknown>): string {
  const graphqlId = optionalString(payload.admin_graphql_api_id);
  if (graphqlId) return graphqlId;
  const numericId = payload.id;
  if (typeof numericId === "number" || typeof numericId === "string") {
    const value = String(numericId).trim();
    if (value) return `gid://shopify/Product/${value}`;
  }
  throw new Error("Webhook product không có product ID");
}

function parseTriggeredAt(value: unknown): Date {
  const text = optionalString(value);
  if (!text) return new Date();
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function required(value: string, name: string): string {
  if (!value.trim()) throw new Error(`${name} không được để trống`);
  return value.trim();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
