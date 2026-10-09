import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { isSameOriginRequest, StandaloneSessions } from "../../../shared/auth/StandaloneSessions.ts";
import { toHttpException } from "../../../shared/nest/toHttpException.ts";
import { standaloneEnabled } from "../../../shared/platform.ts";
import { RegisterAccount, SignIn } from "../application/StandaloneAccounts.ts";
import type { AccountRepository } from "../application/StandalonePorts.ts";
import {
  EmailTakenError,
  InvalidAccountInputError,
  InvalidCredentialsError,
  type Account,
} from "../domain/Account.ts";
import { ACCOUNT_REPOSITORY } from "../tokens.ts";

/** Route này nằm ngoài middleware xác thực nên tự đọc cookie session. */
@Controller("api/standalone/auth")
export class StandaloneAuthController {
  constructor(
    @Inject(RegisterAccount) private readonly registerAccount: RegisterAccount,
    @Inject(SignIn) private readonly signIn: SignIn,
    @Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepository,
    @Inject(StandaloneSessions) private readonly sessions: StandaloneSessions,
  ) {}

  @Get("me")
  async me(@Req() request: Request) {
    assertEnabled();
    const session = this.sessions.read(request);
    const account = session ? await this.accounts.findById(session.accountId) : null;
    if (!account) throw new UnauthorizedException({ error: "Chưa đăng nhập" });
    return toResponse(account);
  }

  @Post("signup")
  async signup(
    @Body() body: { email?: unknown; password?: unknown } | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertWritable(request);
    try {
      const account = await this.registerAccount.execute({
        email: body?.email,
        password: body?.password,
      });
      this.sessions.issue(request, response, account.id);
      return toResponse(account);
    } catch (error) {
      throw toAuthException(error);
    }
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: { email?: unknown; password?: unknown } | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertWritable(request);
    try {
      const account = await this.signIn.execute({ email: body?.email, password: body?.password });
      this.sessions.issue(request, response, account.id);
      return toResponse(account);
    } catch (error) {
      throw toAuthException(error);
    }
  }

  @Post("logout")
  @HttpCode(HttpStatus.OK)
  logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    assertWritable(request);
    this.sessions.clear(request, response);
    return { success: true };
  }
}

function assertEnabled(): void {
  if (!standaloneEnabled()) throw new NotFoundException({ error: "Chế độ độc lập đang tắt" });
}

function assertWritable(request: Request): void {
  assertEnabled();
  if (!isSameOriginRequest(request)) {
    throw new ForbiddenException({ error: "Request không cùng nguồn gốc với app" });
  }
}

function toAuthException(error: unknown): HttpException {
  if (error instanceof InvalidAccountInputError) {
    return new HttpException({ error: error.message }, HttpStatus.BAD_REQUEST);
  }
  if (error instanceof EmailTakenError) {
    return new HttpException({ error: error.message }, HttpStatus.CONFLICT);
  }
  if (error instanceof InvalidCredentialsError) {
    return new HttpException({ error: error.message }, HttpStatus.UNAUTHORIZED);
  }
  return toHttpException("StandaloneAuth", error, HttpStatus.INTERNAL_SERVER_ERROR, "Không xử lý được yêu cầu đăng nhập");
}

function toResponse(account: Account) {
  return { account: { email: account.email } };
}
