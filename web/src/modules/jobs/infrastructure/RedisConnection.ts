import type { ConnectionOptions } from "bullmq";

export interface RedisRuntimeConfig {
  queueName: string;
  prefix?: string;
  concurrency: number;
  producerConnection: ConnectionOptions;
  workerConnection: ConnectionOptions;
}

type Environment = Record<string, string | undefined>;

export function redisRuntimeConfigFromEnv(
  environment: Environment = process.env
): RedisRuntimeConfig {
  const baseConnection = environment.REDIS_URL?.trim()
    ? connectionFromUrl(environment.REDIS_URL.trim())
    : connectionFromFields(environment);

  const queueName = environment.BULLMQ_QUEUE_NAME?.trim() || "watermark-processing";
  const prefix = environment.BULLMQ_PREFIX?.trim() || undefined;
  const concurrency = positiveInteger(
    environment.BULLMQ_WORKER_CONCURRENCY,
    2,
    "BULLMQ_WORKER_CONCURRENCY"
  );

  return {
    queueName,
    prefix,
    concurrency,
    // API request nên báo lỗi sớm nếu Redis không sẵn sàng.
    producerConnection: {
      ...baseConnection,
      maxRetriesPerRequest: 1,
    },
    // Worker là tiến trình nền dài hạn, nên để BullMQ tự reconnect.
    workerConnection: {
      ...baseConnection,
      maxRetriesPerRequest: null,
    },
  };
}

function connectionFromFields(environment: Environment): ConnectionOptions {
  return {
    host: environment.REDIS_HOST?.trim() || "127.0.0.1",
    port: positiveInteger(environment.REDIS_PORT, 6379, "REDIS_PORT"),
    username: optional(environment.REDIS_USERNAME),
    password: optional(environment.REDIS_PASSWORD),
    db: nonNegativeInteger(environment.REDIS_DB, 0, "REDIS_DB"),
  };
}

function connectionFromUrl(value: string): ConnectionOptions {
  const url = new URL(value);
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error("REDIS_URL phải bắt đầu bằng redis:// hoặc rediss://");
  }
  if (!url.hostname) throw new Error("REDIS_URL phải có hostname");

  const databaseText = url.pathname.replace(/^\//, "");
  const database = databaseText
    ? nonNegativeInteger(databaseText, 0, "database trong REDIS_URL")
    : 0;

  return {
    host: url.hostname,
    port: url.port
      ? positiveInteger(url.port, 6379, "port trong REDIS_URL")
      : 6379,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: database,
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
  };
}

function optional(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  name: string
): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} phải là số nguyên lớn hơn 0`);
  }
  return parsed;
}

function nonNegativeInteger(
  value: string | undefined,
  fallback: number,
  name: string
): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} phải là số nguyên không âm`);
  }
  return parsed;
}
