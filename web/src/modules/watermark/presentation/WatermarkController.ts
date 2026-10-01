import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post } from "@nestjs/common";
import type { Session } from "@shopify/shopify-api";
import { ShopifySession } from "../../../shared/nest/ShopifySession.ts";
import { toHttpException } from "../../../shared/nest/toHttpException.ts";
import { EnqueueJob } from "../../jobs/application/EnqueueJob.ts";
import { WATERMARK_PROCESS_V1 } from "../../jobs/domain/JobDefinitions.ts";
import { CancelWatermarkBatch } from "../application/CancelWatermarkBatch.ts";
import { CancelWatermarkJob } from "../application/CancelWatermarkJob.ts";
import { CreateWatermarkBatch } from "../application/CreateWatermarkBatch.ts";
import { CreateWatermarkJob } from "../application/CreateWatermarkJob.ts";
import { GetWatermarkJob } from "../application/GetWatermarkJob.ts";
import { ListWatermarkBatches } from "../application/ListWatermarkBatches.ts";
import { ListWatermarkJobs } from "../application/ListWatermarkJobs.ts";
import { ProcessWatermarkJob } from "../application/ProcessWatermarkJob.ts";
import { RetryWatermarkJob } from "../application/RetryWatermarkJob.ts";
import type { WatermarkBatchSelection } from "../application/BulkWatermarkPorts.ts";
import type { WatermarkJob } from "../domain/WatermarkJob.ts";
import {
  BatchSelectionPipe,
  WatermarkConfigurationPipe,
  type WatermarkConfigurationInput,
} from "./WatermarkPipes.ts";

@Controller("api/watermarks")
export class WatermarkController {
  constructor(
    @Inject(CreateWatermarkJob) private readonly createWatermarkJob: CreateWatermarkJob,
    @Inject(ListWatermarkJobs) private readonly listWatermarkJobs: ListWatermarkJobs,
    @Inject(GetWatermarkJob) private readonly getWatermarkJob: GetWatermarkJob,
    @Inject(RetryWatermarkJob) private readonly retryWatermarkJob: RetryWatermarkJob,
    @Inject(CancelWatermarkJob) private readonly cancelWatermarkJob: CancelWatermarkJob,
    @Inject(ProcessWatermarkJob) private readonly processWatermarkJob: ProcessWatermarkJob,
    @Inject(CreateWatermarkBatch) private readonly createWatermarkBatch: CreateWatermarkBatch,
    @Inject(ListWatermarkBatches) private readonly listWatermarkBatches: ListWatermarkBatches,
    @Inject(CancelWatermarkBatch) private readonly cancelWatermarkBatch: CancelWatermarkBatch,
    @Inject(EnqueueJob) private readonly enqueueJob: EnqueueJob,
  ) {}

  @Get("jobs")
  async listJobs(@ShopifySession() session: Session) {
    try {
      const jobs = await this.listWatermarkJobs.execute(session.shop);
      return { jobs: jobs.map(toResponse) };
    } catch (error) {
      throw toHttpException("Watermark", error);
    }
  }

  @Get("batches")
  async listBatches(@ShopifySession() session: Session) {
    try {
      const batches = await this.listWatermarkBatches.execute(session.shop);
      return { batches };
    } catch (error) {
      throw toHttpException("Watermark", error);
    }
  }

  @Post("batches")
  async createBatch(
    @Body(BatchSelectionPipe) selection: WatermarkBatchSelection,
    @Body(WatermarkConfigurationPipe) configuration: WatermarkConfigurationInput,
    @ShopifySession() session: Session,
  ) {
    try {
      const batch = await this.createWatermarkBatch.execute({
        shopDomain: session.shop,
        selection,
        configuration,
      });
      return {
        batch: {
          id: batch.id,
          totalJobs: batch.totalJobs,
          skippedProducts: batch.skippedProducts,
          createdAt: batch.createdAt,
        },
      };
    } catch (error) {
      throw toHttpException("Watermark", error, HttpStatus.BAD_REQUEST);
    }
  }

  @Post("batches/:id/cancel")
  @HttpCode(HttpStatus.OK)
  async cancelBatch(@Param("id") id: string, @ShopifySession() session: Session) {
    try {
      await this.cancelWatermarkBatch.execute(id, session.shop);
      return { success: true };
    } catch (error) {
      throw toHttpException("Watermark", error, HttpStatus.BAD_REQUEST);
    }
  }

  @Post("jobs")
  async createJob(
    @Body("productId") productId: unknown,
    @Body(WatermarkConfigurationPipe) configuration: WatermarkConfigurationInput,
    @ShopifySession() session: Session,
  ) {
    try {
      const shopDomain = session.shop;
      const job = await this.createWatermarkJob.execute({
        shopDomain,
        productId: String(productId ?? ""),
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
      await this.enqueueJob.execute({
        ...WATERMARK_PROCESS_V1,
        payload: { jobId: job.id, shopDomain },
      });
      return { job: toResponse(job) };
    } catch (error) {
      throw toHttpException("Watermark", error, HttpStatus.BAD_REQUEST);
    }
  }

  @Get("jobs/:id")
  async getJob(@Param("id") id: string, @ShopifySession() session: Session) {
    try {
      const job = await this.getWatermarkJob.execute(id, session.shop);
      return { job: toResponse(job) };
    } catch (error) {
      throw toHttpException("Watermark", error, HttpStatus.NOT_FOUND);
    }
  }

  @Post("jobs/:id/retry")
  @HttpCode(HttpStatus.ACCEPTED)
  async retryJob(@Param("id") id: string, @ShopifySession() session: Session) {
    try {
      const shopDomain = session.shop;
      const job = await this.retryWatermarkJob.execute(id, shopDomain);
      await this.enqueueJob.execute({
        ...WATERMARK_PROCESS_V1,
        payload: { jobId: job.id, shopDomain },
      });
      return { job: toResponse(job) };
    } catch (error) {
      throw toHttpException("Watermark", error, HttpStatus.BAD_REQUEST);
    }
  }

  @Post("jobs/:id/cancel")
  @HttpCode(HttpStatus.OK)
  async cancelJob(@Param("id") id: string, @ShopifySession() session: Session) {
    try {
      const job = await this.cancelWatermarkJob.execute(id, session.shop);
      return { job: toResponse(job) };
    } catch (error) {
      throw toHttpException("Watermark", error, HttpStatus.BAD_REQUEST);
    }
  }

  @Post("jobs/:id/process")
  @HttpCode(HttpStatus.OK)
  async processJob(@Param("id") id: string, @ShopifySession() session: Session) {
    try {
      const job = await this.processWatermarkJob.execute(id, session.shop);
      return { job: toResponse(job) };
    } catch (error) {
      throw toHttpException("Watermark", error);
    }
  }
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
