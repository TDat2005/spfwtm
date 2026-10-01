import { Body, Controller, Get, Inject, Param, Post, Res } from "@nestjs/common";
import { APP_DEPENDENCIES, type AppDependencies } from "../../../app/AppDependencies.ts";
import { routeError, type ShopifyResponse } from "../../../app/ShopifyResponse.ts";
import type {
  WatermarkJob,
  WatermarkFontFamily,
  WatermarkLayout,
  WatermarkPosition,
} from "../domain/WatermarkJob.ts";
import { WATERMARK_PROCESS_V1 } from "../../jobs/domain/JobDefinitions.ts";

const positions = new Set<WatermarkPosition>([
  "TOP_LEFT", "TOP_CENTER", "TOP_RIGHT", "MIDDLE_LEFT", "CENTER",
  "MIDDLE_RIGHT", "BOTTOM_LEFT", "BOTTOM_CENTER", "BOTTOM_RIGHT",
]);
const layouts = new Set<WatermarkLayout>(["SINGLE", "TILED"]);

@Controller("api/watermarks")
export class WatermarkController {
  constructor(@Inject(APP_DEPENDENCIES) private readonly dependencies: AppDependencies) {}

  @Get("jobs")
  async listJobs(@Res() response: ShopifyResponse): Promise<void> {
    try {
      const jobs = await this.dependencies.listWatermarkJobs.execute(response.locals.shopify.session.shop);
      response.status(200).send({ jobs: jobs.map(toResponse) });
    } catch (error) {
      routeError(response, "Watermark", error);
    }
  }

  @Get("batches")
  async listBatches(@Res() response: ShopifyResponse): Promise<void> {
    try {
      const batches = await this.dependencies.listWatermarkBatches.execute(
        response.locals.shopify.session.shop,
      );
      response.status(200).send({ batches });
    } catch (error) {
      routeError(response, "Watermark", error);
    }
  }

  @Post("batches")
  async createBatch(
    @Body() body: Record<string, unknown>,
    @Res() response: ShopifyResponse,
  ): Promise<void> {
    try {
      const rawProductIds = body.productIds;
      if (!Array.isArray(rawProductIds)) throw new Error("productIds phải là một mảng");
      const batch = await this.dependencies.createWatermarkBatch.execute({
        shopDomain: response.locals.shopify.session.shop,
        productIds: rawProductIds.map(String),
        configuration: parseConfiguration(body),
      });
      response.status(201).send({
        batch: { id: batch.id, totalJobs: batch.totalJobs, createdAt: batch.createdAt },
      });
    } catch (error) {
      routeError(response, "Watermark", error, 400);
    }
  }

  @Post("batches/:id/cancel")
  async cancelBatch(@Param("id") id: string, @Res() response: ShopifyResponse): Promise<void> {
    try {
      await this.dependencies.cancelWatermarkBatch.execute(id, response.locals.shopify.session.shop);
      response.status(200).send({ success: true });
    } catch (error) {
      routeError(response, "Watermark", error, 400);
    }
  }

  @Post("jobs")
  async createJob(
    @Body() body: Record<string, unknown>,
    @Res() response: ShopifyResponse,
  ): Promise<void> {
    try {
      const configuration = parseConfiguration(body);
      const shopDomain = response.locals.shopify.session.shop;
      const job = await this.dependencies.createWatermarkJob.execute({
        shopDomain,
        productId: String(body.productId ?? ""),
        watermarkType: configuration.type,
        text: configuration.text,
        logoUrl: configuration.logoUrl,
        logoScale: configuration.logoScale,
        position: configuration.position,
        opacity: configuration.opacity,
        layout: configuration.layout,
        rotation: configuration.rotation,
        offsetX: configuration.offsetX,
        offsetY: configuration.offsetY,
        fontFamily: configuration.fontFamily,
        fontSize: configuration.fontSize,
        textColor: configuration.textColor,
        strokeColor: configuration.strokeColor,
        strokeWidth: configuration.strokeWidth,
      });
      await this.dependencies.enqueueJob.execute({
        ...WATERMARK_PROCESS_V1,
        payload: { jobId: job.id, shopDomain },
      });
      response.status(201).send({ job: toResponse(job) });
    } catch (error) {
      routeError(response, "Watermark", error, 400);
    }
  }

  @Get("jobs/:id")
  async getJob(@Param("id") id: string, @Res() response: ShopifyResponse): Promise<void> {
    try {
      const job = await this.dependencies.getWatermarkJob.execute(id, response.locals.shopify.session.shop);
      response.status(200).send({ job: toResponse(job) });
    } catch (error) {
      routeError(response, "Watermark", error, 404);
    }
  }

  @Post("jobs/:id/retry")
  async retryJob(@Param("id") id: string, @Res() response: ShopifyResponse): Promise<void> {
    try {
      const shopDomain = response.locals.shopify.session.shop;
      const job = await this.dependencies.retryWatermarkJob.execute(id, shopDomain);
      await this.dependencies.enqueueJob.execute({
        ...WATERMARK_PROCESS_V1,
        payload: { jobId: job.id, shopDomain },
      });
      response.status(202).send({ job: toResponse(job) });
    } catch (error) {
      routeError(response, "Watermark", error, 400);
    }
  }

  @Post("jobs/:id/cancel")
  async cancelJob(@Param("id") id: string, @Res() response: ShopifyResponse): Promise<void> {
    try {
      const job = await this.dependencies.cancelWatermarkJob.execute(
        id,
        response.locals.shopify.session.shop,
      );
      response.status(200).send({ job: toResponse(job) });
    } catch (error) {
      routeError(response, "Watermark", error, 400);
    }
  }

  @Post("jobs/:id/process")
  async processJob(@Param("id") id: string, @Res() response: ShopifyResponse): Promise<void> {
    try {
      const job = await this.dependencies.processWatermarkJob.execute(
        id,
        response.locals.shopify.session.shop,
      );
      response.status(200).send({ job: toResponse(job) });
    } catch (error) {
      routeError(response, "Watermark", error);
    }
  }
}

function parseConfiguration(body: Record<string, unknown>) {
  const position = String(body.position ?? "BOTTOM_RIGHT") as WatermarkPosition;
  if (!positions.has(position)) throw new Error("Vị trí watermark không hợp lệ");
  const layout = String(body.layout ?? "SINGLE") as WatermarkLayout;
  if (!layouts.has(layout)) throw new Error("Kiểu bố trí watermark không hợp lệ");
  return {
    type: body.watermarkType === "IMAGE" ? ("IMAGE" as const) : ("TEXT" as const),
    text: body.text !== undefined && body.text !== null ? String(body.text) : null,
    logoUrl: body.logoUrl !== undefined && body.logoUrl !== null ? String(body.logoUrl) : null,
    logoScale: Number(body.logoScale ?? 0.2),
    position,
    opacity: Number(body.opacity ?? 0.7),
    layout,
    rotation: Number(body.rotation ?? 0),
    offsetX: Number(body.offsetX ?? 0),
    offsetY: Number(body.offsetY ?? 0),
    fontFamily: String(body.fontFamily ?? "Arial") as WatermarkFontFamily,
    fontSize: Number(body.fontSize ?? 0.045),
    textColor: String(body.textColor ?? "#FFFFFF"),
    strokeColor: String(body.strokeColor ?? "#000000"),
    strokeWidth: Number(body.strokeWidth ?? 2),
  };
}

function toResponse(job: WatermarkJob) {
  return {
    id: job.id,
    productId: job.productId,
    watermarkType: job.watermarkType,
    text: job.text,
    logoUrl: job.logoUrl,
    logoScale: job.logoScale,
    position: job.position,
    opacity: job.opacity,
    layout: job.layout,
    rotation: job.rotation,
    offsetX: job.offsetX,
    offsetY: job.offsetY,
    fontFamily: job.fontFamily,
    fontSize: job.fontSize,
    textColor: job.textColor,
    strokeColor: job.strokeColor,
    strokeWidth: job.strokeWidth,
    status: job.status,
    resultMediaId: job.resultMediaId,
    resultUrl: job.resultMediaId ? `/api/media/assets/${job.resultMediaId}/content` : null,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
  };
}
