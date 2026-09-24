import express from "express";
import type { Request, Response } from "express";
import type { Session } from "@shopify/shopify-api";
import type { CreateWatermarkJob } from "../application/CreateWatermarkJob.ts";
import type { ListWatermarkJobs } from "../application/ListWatermarkJobs.ts";
import type { ProcessWatermarkJob } from "../application/ProcessWatermarkJob.ts";
import type { GetWatermarkJob } from "../application/GetWatermarkJob.ts";
import type { RetryWatermarkJob } from "../application/RetryWatermarkJob.ts";
import type { CancelWatermarkJob } from "../application/CancelWatermarkJob.ts";
import type { EnqueueJob } from "../../jobs/application/EnqueueJob.ts";
import type {
  WatermarkJob,
  WatermarkFontFamily,
  WatermarkLayout,
  WatermarkPosition,
} from "../domain/WatermarkJob.ts";
import { WATERMARK_PROCESS_V1 } from "../../jobs/domain/JobDefinitions.ts";

interface Dependencies {
  createWatermarkJob: CreateWatermarkJob;
  listWatermarkJobs: ListWatermarkJobs;
  processWatermarkJob: ProcessWatermarkJob;
  getWatermarkJob: GetWatermarkJob;
  retryWatermarkJob: RetryWatermarkJob;
  cancelWatermarkJob: CancelWatermarkJob;
  enqueueJob?: EnqueueJob;
}
interface ShopifyLocals extends Record<string, unknown> {
  shopify: { session: Session };
}
const positions = new Set<WatermarkPosition>([
  "TOP_LEFT",
  "TOP_CENTER",
  "TOP_RIGHT",
  "MIDDLE_LEFT",
  "CENTER",
  "MIDDLE_RIGHT",
  "BOTTOM_LEFT",
  "BOTTOM_CENTER",
  "BOTTOM_RIGHT",
]);
const layouts = new Set<WatermarkLayout>(["SINGLE", "TILED"]);

export function createWatermarkRouter(dependencies: Dependencies) {
  const router = express.Router();

  router.get(
    "/jobs",
    async (_request: Request, response: Response<unknown, ShopifyLocals>) => {
      try {
        const jobs = await dependencies.listWatermarkJobs.execute(
          response.locals.shopify.session.shop
        );
        response.status(200).send({ jobs: jobs.map(toResponse) });
      } catch (error) {
        sendError(response, error);
      }
    }
  );

  router.post(
    "/jobs",
    async (request: Request, response: Response<unknown, ShopifyLocals>) => {
      try {
        const body = request.body as Record<string, unknown>;
        const position = String(
          body.position ?? "BOTTOM_RIGHT"
        ) as WatermarkPosition;
        if (!positions.has(position))
          throw new Error("Vị trí watermark không hợp lệ");
        const layout = String(body.layout ?? "SINGLE") as WatermarkLayout;
        if (!layouts.has(layout)) throw new Error("Kiểu bố trí watermark không hợp lệ");
        const job = await dependencies.createWatermarkJob.execute({
          shopDomain: response.locals.shopify.session.shop,
          productId: String(body.productId ?? ""),
          watermarkType: body.watermarkType === "IMAGE" ? "IMAGE" : "TEXT",
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
        });

        if (dependencies.enqueueJob) {
          await dependencies.enqueueJob.execute({
            ...WATERMARK_PROCESS_V1,
            payload: {
              jobId: job.id,
              shopDomain: response.locals.shopify.session.shop,
            },
          });
        }

        response.status(201).send({ job: toResponse(job) });
      } catch (error) {
        sendError(response, error, 400);
      }
    }
  );

  router.get(
    "/jobs/:id",
    async (request: Request, response: Response<unknown, ShopifyLocals>) => {
      try {
        const job = await dependencies.getWatermarkJob.execute(
          parameter(request.params.id),
          response.locals.shopify.session.shop
        );
        response.status(200).send({ job: toResponse(job) });
      } catch (error) {
        sendError(response, error, 404);
      }
    }
  );

  router.post(
    "/jobs/:id/retry",
    async (request: Request, response: Response<unknown, ShopifyLocals>) => {
      try {
        const shopDomain = response.locals.shopify.session.shop;
        const job = await dependencies.retryWatermarkJob.execute(
          parameter(request.params.id),
          shopDomain
        );
        if (dependencies.enqueueJob) {
          await dependencies.enqueueJob.execute({
            ...WATERMARK_PROCESS_V1,
            payload: { jobId: job.id, shopDomain },
          });
        }
        response.status(202).send({ job: toResponse(job) });
      } catch (error) {
        sendError(response, error, 400);
      }
    }
  );

  router.post(
    "/jobs/:id/cancel",
    async (request: Request, response: Response<unknown, ShopifyLocals>) => {
      try {
        const job = await dependencies.cancelWatermarkJob.execute(
          parameter(request.params.id),
          response.locals.shopify.session.shop
        );
        response.status(200).send({ job: toResponse(job) });
      } catch (error) {
        sendError(response, error, 400);
      }
    }
  );

  router.post(
    "/jobs/:id/process",
    async (request: Request, response: Response<unknown, ShopifyLocals>) => {
      try {
        const id = parameter(request.params.id);
        const job = await dependencies.processWatermarkJob.execute(
          id,
          response.locals.shopify.session.shop
        );
        response.status(200).send({ job: toResponse(job) });
      } catch (error) {
        sendError(response, error);
      }
    }
  );
  return router;
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
    resultUrl: job.resultMediaId
      ? `/api/media/assets/${job.resultMediaId}/content`
      : null,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
  };
}

function parameter(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function sendError(response: Response, error: unknown, status = 500): void {
  const message = error instanceof Error ? error.message : "Lỗi không xác định";
  console.error("Watermark error:", message);
  response.status(status).send({ error: message });
}
