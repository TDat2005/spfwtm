import { describe, expect, it } from "vitest";
import { redisRuntimeConfigFromEnv } from "./RedisConnection.ts";

describe("redisRuntimeConfigFromEnv", () => {
  it("dùng cấu hình local an toàn làm mặc định", () => {
    const config = redisRuntimeConfigFromEnv({});

    expect(config.lanes).toEqual({
      interactive: {
        lane: "interactive",
        queueName: "watermark-processing-interactive",
        concurrency: 2,
      },
      bulk: { lane: "bulk", queueName: "watermark-processing-bulk", concurrency: 2 },
      system: { lane: "system", queueName: "watermark-processing", concurrency: 2 },
    });
    expect(config.workerEnabled).toBe(true);
    expect(config.workerLanes).toEqual(["interactive", "bulk", "system"]);
    expect(config.producerConnection).toMatchObject({
      host: "127.0.0.1",
      port: 6379,
      db: 0,
      maxRetriesPerRequest: 1,
    });
    expect(config.workerConnection).toMatchObject({
      maxRetriesPerRequest: null,
    });
  });

  it("đọc REDIS_URL có auth, database và TLS", () => {
    const config = redisRuntimeConfigFromEnv({
      REDIS_URL: "rediss://queue-user:p%40ss@redis.example.com:6380/3",
      BULLMQ_QUEUE_NAME: "image-jobs",
      BULLMQ_PREFIX: "competitive-app",
      BULLMQ_WORKER_CONCURRENCY: "4",
    });

    expect(config).toMatchObject({
      prefix: "competitive-app",
      lanes: {
        interactive: { queueName: "image-jobs-interactive", concurrency: 4 },
        bulk: { queueName: "image-jobs-bulk", concurrency: 4 },
        system: { queueName: "image-jobs", concurrency: 4 },
      },
      producerConnection: {
        host: "redis.example.com",
        port: 6380,
        username: "queue-user",
        password: "p@ss",
        db: 3,
        tls: {},
      },
    });
  });

  it("cho phép cấu hình concurrency và lane riêng cho từng tiến trình", () => {
    const config = redisRuntimeConfigFromEnv({
      BULLMQ_WORKER_CONCURRENCY: "3",
      BULLMQ_BULK_CONCURRENCY: "8",
      WORKER_LANES: "bulk, system",
    });

    expect(config.lanes.interactive.concurrency).toBe(3);
    expect(config.lanes.bulk.concurrency).toBe(8);
    expect(config.workerLanes).toEqual(["bulk", "system"]);
  });

  it("tắt worker trong tiến trình web khi WORKER_ENABLED=false", () => {
    expect(redisRuntimeConfigFromEnv({ WORKER_ENABLED: "false" }).workerEnabled).toBe(false);
  });

  it("từ chối cấu hình không hợp lệ", () => {
    expect(() =>
      redisRuntimeConfigFromEnv({ BULLMQ_WORKER_CONCURRENCY: "0" })
    ).toThrow("BULLMQ_WORKER_CONCURRENCY phải là số nguyên lớn hơn 0");
    expect(() =>
      redisRuntimeConfigFromEnv({ BULLMQ_INTERACTIVE_CONCURRENCY: "-1" })
    ).toThrow("BULLMQ_INTERACTIVE_CONCURRENCY phải là số nguyên lớn hơn 0");
    expect(() => redisRuntimeConfigFromEnv({ WORKER_LANES: "urgent" })).toThrow(
      "WORKER_LANES chứa lane không hợp lệ: urgent"
    );
  });
});
