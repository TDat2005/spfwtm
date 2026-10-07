import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import type { Session } from "@shopify/shopify-api";
import { ShopifySession } from "../../../shared/nest/ShopifySession.ts";
import { toHttpException } from "../../../shared/nest/toHttpException.ts";
import {
  MAX_WATERMARK_LAYERS,
  toLayerProps,
  type WatermarkLayerProps,
} from "../../watermark/domain/WatermarkDesign.ts";
import type { ShopCollectionsFactory } from "../application/AutoWatermarkPorts.ts";
import {
  ManageAutoWatermarkRules,
  type RuleSettingsInput,
  type RuleWithDesign,
} from "../application/ManageAutoWatermarkRules.ts";
import { AUTO_WATERMARK_SCOPES, type AutoWatermarkScope } from "../domain/AutoWatermarkRule.ts";
import { SHOP_COLLECTIONS } from "../tokens.ts";

@Controller("api/auto-watermark")
export class AutoWatermarkController {
  constructor(
    @Inject(ManageAutoWatermarkRules) private readonly manage: ManageAutoWatermarkRules,
    @Inject(SHOP_COLLECTIONS) private readonly collections: ShopCollectionsFactory,
  ) {}

  @Get("rules")
  async listRules(@ShopifySession() session: Session) {
    try {
      return { rules: (await this.manage.list(session.shop)).map(toResponse) };
    } catch (error) {
      throw toHttpException("AutoWatermark", error);
    }
  }

  @Post("rules")
  async createRule(@Body() body: Record<string, unknown>, @ShopifySession() session: Session) {
    const settings = parseSettings(body, "create") as RuleSettingsInput;
    const layers = parseLayers(body.layers);
    if (!layers) throw new BadRequestException({ error: "Rule phải có thiết kế watermark (layers)" });
    try {
      const rule = await this.manage.create({
        ...settings,
        shopDomain: session.shop,
        layers,
        applyNow: body.applyNow === true,
      });
      return { rule: { id: rule.id } };
    } catch (error) {
      throw toHttpException("AutoWatermark", error, HttpStatus.BAD_REQUEST);
    }
  }

  @Patch("rules/:id")
  async updateRule(
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
    @ShopifySession() session: Session,
  ) {
    const settings = parseSettings(body, "update");
    const layers = parseLayers(body.layers);
    try {
      await this.manage.update({ ...settings, id, shopDomain: session.shop, layers: layers ?? undefined });
      return { success: true };
    } catch (error) {
      throw toHttpException("AutoWatermark", error, HttpStatus.BAD_REQUEST);
    }
  }

  @Delete("rules/:id")
  @HttpCode(HttpStatus.OK)
  async deleteRule(@Param("id") id: string, @ShopifySession() session: Session) {
    try {
      await this.manage.delete(id, session.shop);
      return { success: true };
    } catch (error) {
      throw toHttpException("AutoWatermark", error, HttpStatus.BAD_REQUEST);
    }
  }

  @Post("rules/:id/apply")
  @HttpCode(HttpStatus.ACCEPTED)
  async applyRule(@Param("id") id: string, @ShopifySession() session: Session) {
    try {
      await this.manage.apply(id, session.shop);
      return { success: true };
    } catch (error) {
      throw toHttpException("AutoWatermark", error, HttpStatus.BAD_REQUEST);
    }
  }

  @Get("collections")
  async searchCollections(@Query("query") query: unknown, @ShopifySession() session: Session) {
    try {
      const collections = await this.collections.forShop(session.shop);
      return { collections: await collections.search(typeof query === "string" ? query : "") };
    } catch (error) {
      throw toHttpException("AutoWatermark", error);
    }
  }
}

function toResponse({ rule, design }: RuleWithDesign) {
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    priority: rule.priority,
    scope: rule.scope,
    scopeValue: rule.scopeValue,
    scopeLabel: rule.scopeLabel,
    onNewProduct: rule.onNewProduct,
    onPrimaryChanged: rule.onPrimaryChanged,
    syncScope: rule.syncScope,
    autoPublish: rule.autoPublish,
    lastAppliedAt: rule.lastAppliedAt,
    createdAt: rule.createdAt,
    design: design ? { layers: design.toJSON().layers, summary: design.summary } : null,
  };
}

function parseSettings(
  body: Record<string, unknown>,
  mode: "create" | "update",
): Partial<RuleSettingsInput> {
  const settings: Partial<RuleSettingsInput> = {};
  const required = mode === "create";

  if (body.name !== undefined || required) {
    if (typeof body.name !== "string") throw badRequest("Tên rule phải là chuỗi");
    settings.name = body.name;
  }
  if (body.scope !== undefined || required) {
    if (!AUTO_WATERMARK_SCOPES.includes(body.scope as AutoWatermarkScope)) {
      throw badRequest("Phạm vi rule không hợp lệ");
    }
    settings.scope = body.scope as AutoWatermarkScope;
    // Phạm vi và giá trị phạm vi luôn đi cùng nhau.
    if (body.scopeValue !== null && body.scopeValue !== undefined && typeof body.scopeValue !== "string") {
      throw badRequest("scopeValue phải là chuỗi");
    }
    settings.scopeValue = (body.scopeValue as string | null | undefined) ?? null;
  }
  if (body.priority !== undefined || required) {
    const priority = Number(body.priority ?? 0);
    if (!Number.isInteger(priority)) throw badRequest("Độ ưu tiên phải là số nguyên");
    settings.priority = priority;
  }
  const flags = ["enabled", "onNewProduct", "onPrimaryChanged", "syncScope", "autoPublish"] as const;
  const defaults = { enabled: true, onNewProduct: true, onPrimaryChanged: false, syncScope: false, autoPublish: false };
  for (const flag of flags) {
    const value = body[flag];
    if (value === undefined) {
      if (required) settings[flag] = defaults[flag];
      continue;
    }
    if (typeof value !== "boolean") throw badRequest(`${flag} phải là true/false`);
    settings[flag] = value;
  }
  return settings;
}

function parseLayers(value: unknown): WatermarkLayerProps[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) throw badRequest("layers phải là một mảng");
  if (value.length > MAX_WATERMARK_LAYERS) {
    throw badRequest(`Thiết kế watermark tối đa ${MAX_WATERMARK_LAYERS} lớp`);
  }
  return value.map((layer, index) => {
    if (!layer || typeof layer !== "object" || Array.isArray(layer)) {
      throw badRequest(`Lớp ${index + 1} không hợp lệ`);
    }
    return toLayerProps(layer as Record<string, unknown>);
  });
}

function badRequest(error: string): BadRequestException {
  return new BadRequestException({ error });
}
