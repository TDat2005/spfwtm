import express from "express";
import type { Request, Response } from "express";
import type { Session } from "@shopify/shopify-api";
import type { CreateWatermarkJob } from "../application/CreateWatermarkJob.ts";
import type { ListWatermarkJobs } from "../application/ListWatermarkJobs.ts";
import type { ProcessWatermarkJob } from "../application/ProcessWatermarkJob.ts";
import type {
  WatermarkJob,
  WatermarkPosition,
} from "../domain/WatermarkJob.ts";

interface Dependencies {
  createWatermarkJob: CreateWatermarkJob;
  listWatermarkJobs: ListWatermarkJobs;
  processWatermarkJob: ProcessWatermarkJob;
}
interface ShopifyLocals extends Record<string, unknown> {
  shopify: { session: Session };
}
const positions = new Set<WatermarkPosition>([
  "TOP_LEFT",
  "TOP_RIGHT",
  "CENTER",
  "BOTTOM_LEFT",
  "BOTTOM_RIGHT",
]);

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
        const job = await dependencies.createWatermarkJob.execute({
          shopDomain: response.locals.shopify.session.shop,
          productId: String(body.productId ?? ""),
          watermarkType: body.watermarkType === "IMAGE" ? "IMAGE" : "TEXT",
          text: body.text !== undefined && body.text !== null ? String(body.text) : null,
          logoUrl: body.logoUrl !== undefined && body.logoUrl !== null ? String(body.logoUrl) : null,
          logoScale: Number(body.logoScale ?? 0.2),
          position,
          opacity: Number(body.opacity ?? 0.7),
        });
        response.status(201).send({ job: toResponse(job) });
      } catch (error) {
        sendError(response, error, 400);
      }
    }
  );

  router.post(
    "/jobs/:id/process",
    async (request: Request, response: Response<unknown, ShopifyLocals>) => {
      try {
        const id = Array.isArray(request.params.id)
          ? request.params.id[0] ?? ""
          : request.params.id ?? "";
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
    status: job.status,
    resultMediaId: job.resultMediaId,
    resultUrl: job.resultMediaId
      ? `/api/media/assets/${job.resultMediaId}/content`
      : null,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
  };
}

function sendError(response: Response, error: unknown, status = 500): void {
  const message = error instanceof Error ? error.message : "Lỗi không xác định";
  console.error("Watermark error:", message);
  response.status(status).send({ error: message });
}
