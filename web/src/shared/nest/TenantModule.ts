import {
  Global,
  Inject,
  Module,
  RequestMethod,
  type MiddlewareConsumer,
  type NestModule,
} from "@nestjs/common";
import { StandaloneSessions } from "../auth/StandaloneSessions.ts";
import { createTenantMiddleware } from "./TenantMiddleware.ts";
import { SHOPIFY, type ShopifyApp } from "./tokens.ts";

@Global()
@Module({
  providers: [{ provide: StandaloneSessions, useFactory: () => new StandaloneSessions() }],
  exports: [StandaloneSessions],
})
export class TenantModule implements NestModule {
  constructor(
    @Inject(SHOPIFY) private readonly shopify: ShopifyApp,
    @Inject(StandaloneSessions) private readonly sessions: StandaloneSessions,
  ) {}

  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(createTenantMiddleware(this.shopify, this.sessions))
      // Đăng ký / đăng nhập chạy trước khi có session.
      .exclude({ path: "api/standalone/auth/{*path}", method: RequestMethod.ALL })
      .forRoutes({ path: "api/{*path}", method: RequestMethod.ALL });
  }
}
