import type { ConnectionOptions } from "bullmq";
import { JOB_LANES, type JobLane } from "../domain/JobDefinitions.ts";

export interface LaneRuntimeConfig {
  lane: JobLane;
  queueName: string;
  concurrency: number;
}

export interface RedisRuntimeConfig {
  prefix?: string;
  lanes: Record<JobLane, LaneRuntimeConfig>;
  /** Tiến trình này có chạy worker không (web production nên đặt WORKER_ENABLED=false). */
  workerEnabled: boolean;
  /** Các lane mà worker của tiến trình này xử lý. */
  workerLanes: JobLane[];
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

  const baseQueueName =
    environment.BULLMQ_QUEUE_NAME?.trim() || "watermark-processing";
  const prefix = environment.BULLMQ_PREFIX?.trim() || undefined;
  const defaultConcurrency = positiveInteger(
    environment.BULLMQ_WORKER_CONCURRENCY,
    2,
    "BULLMQ_WORKER_CONCURRENCY"
  );
  const lanes = Object.fromEntries(
    JOB_LANES.map((lane) => {
      const envName = `BULLMQ_${lane.toUpperCase()}_CONCURRENCY`;
      return [
        lane,
        {
          lane,
          queueName: laneQueueName(baseQueueName, lane),
          concurrency: positiveInteger(environment[envName], defaultConcurrency, envName),
        },
      ];
    })
  ) as Record<JobLane, LaneRuntimeConfig>;

  return {
    prefix,
    lanes,
    workerEnabled: booleanFlag(environment.WORKER_ENABLED, true, "WORKER_ENABLED"),
    workerLanes: parseLanes(environment.WORKER_LANES),
    producerConnection: {
      ...baseConnection,
      maxRetriesPerRequest: 1,
    },
    workerConnection: {
      ...baseConnection,
      maxRetriesPerRequest: null,
    },
  };
}

/**
 * Lane system giữ đúng tên queue cũ để worker tiếp tục xử lý những job đã nằm
 * sẵn trong Redis từ trước khi tách lane (worker của mọi lane đều biết mọi handler).
 */
function laneQueueName(baseQueueName: string, lane: JobLane): string {
  return lane === "system" ? baseQueueName : `${baseQueueName}-${lane}`;
}

function parseLanes(value: string | undefined): JobLane[] {
  if (value === undefined || value.trim() === "") return [...JOB_LANES];
  const lanes = value
    .split(",")
    .map((lane) => lane.trim())
    .filter(Boolean);
  for (const lane of lanes) {
    if (!(JOB_LANES as readonly string[]).includes(lane)) {
      throw new Error(`WORKER_LANES chứa lane không hợp lệ: ${lane}`);
    }
  }
  return [...new Set(lanes)] as JobLane[];
}

function booleanFlag(
  value: string | undefined,
  fallback: boolean,
  name: string
): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes"].includes(normalized)) return true;
  if (["0", "false", "no"].includes(normalized)) return false;
  throw new Error(`${name} phải là true hoặc false`);
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
