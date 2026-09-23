import { describe, expect, it } from "vitest";
import { redisRuntimeConfigFromEnv } from "./RedisConnection.ts";

describe("redisRuntimeConfigFromEnv", () => {
  it("dùng cấu hình local an toàn làm mặc định", () => {
    const config = redisRuntimeConfigFromEnv({});

    expect(config.queueName).toBe("watermark-processing");
    expect(config.concurrency).toBe(2);
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
      queueName: "image-jobs",
      prefix: "competitive-app",
      concurrency: 4,
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

  it("từ chối concurrency không hợp lệ", () => {
    expect(() =>
      redisRuntimeConfigFromEnv({ BULLMQ_WORKER_CONCURRENCY: "0" })
    ).toThrow("BULLMQ_WORKER_CONCURRENCY phải là số nguyên lớn hơn 0");
  });
});
