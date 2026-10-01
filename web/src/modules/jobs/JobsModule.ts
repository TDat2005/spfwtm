import {
  Inject,
  Module,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { EnqueueJob } from "./application/EnqueueJob.ts";
import { BullMqJobQueue } from "./infrastructure/BullMqJobQueue.ts";
import { BullMqWorker } from "./infrastructure/BullMqWorker.ts";
import {
  redisRuntimeConfigFromEnv,
  type RedisRuntimeConfig,
} from "./infrastructure/RedisConnection.ts";

const REDIS_RUNTIME_CONFIG = Symbol("REDIS_RUNTIME_CONFIG");

@Module({
  providers: [
    { provide: REDIS_RUNTIME_CONFIG, useFactory: () => redisRuntimeConfigFromEnv() },
    {
      provide: BullMqJobQueue,
      inject: [REDIS_RUNTIME_CONFIG],
      useFactory: (config: RedisRuntimeConfig) =>
        new BullMqJobQueue({
          queueName: config.queueName,
          connection: config.producerConnection,
          prefix: config.prefix,
        }),
    },
    {
      provide: BullMqWorker,
      inject: [REDIS_RUNTIME_CONFIG],
      useFactory: (config: RedisRuntimeConfig) =>
        new BullMqWorker({
          queueName: config.queueName,
          connection: config.workerConnection,
          concurrency: config.concurrency,
          prefix: config.prefix,
        }),
    },
    {
      provide: EnqueueJob,
      inject: [BullMqJobQueue],
      useFactory: (queue: BullMqJobQueue) => new EnqueueJob(queue),
    },
  ],
  exports: [EnqueueJob, BullMqJobQueue, BullMqWorker],
})
export class JobsModule
  implements OnApplicationBootstrap, BeforeApplicationShutdown, OnApplicationShutdown
{
  constructor(
    @Inject(BullMqJobQueue) private readonly queue: BullMqJobQueue,
    @Inject(BullMqWorker) private readonly worker: BullMqWorker,
  ) {}

  // Các module khác đăng ký handler trong onModuleInit, luôn chạy trước hook này.
  onApplicationBootstrap(): void {
    this.worker.start();
  }

  // Chờ job đang chạy xong trước khi Nest đóng HTTP server và Prisma.
  async beforeApplicationShutdown(): Promise<void> {
    await this.worker.stop();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
