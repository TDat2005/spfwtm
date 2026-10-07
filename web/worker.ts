import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./src/app/AppModule.ts";

// Tiến trình này chỉ để xử lý job: không mở HTTP. Chọn lane bằng WORKER_LANES
// (ví dụ "bulk" để chạy nhiều bản chỉ xử lý batch lớn).
process.env.WORKER_ENABLED = "true";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  Logger.log("Worker đã khởi động.", "Bootstrap");
}

void bootstrap().catch((error: unknown) => {
  Logger.error(error, "Không thể khởi động worker");
  process.exitCode = 1;
});
