import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Post } from "@nestjs/common";
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
import { WatermarkDesign, type WatermarkLayerProps } from "../domain/WatermarkDesign.ts";
import type { WatermarkJob } from "../domain/WatermarkJob.ts";
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import { PRISMA_CLIENT } from "../../../shared/nest/tokens.ts";
import { BatchSelectionPipe, WatermarkLayersPipe } from "./WatermarkPipes.ts";

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
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
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
    @Body(WatermarkLayersPipe) layers: WatermarkLayerProps[],
    @ShopifySession() session: Session,
  ) {
    try {
      const batch = await this.createWatermarkBatch.execute({
        shopDomain: session.shop,
        selection,
        layers,
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
    @Body(WatermarkLayersPipe) layers: WatermarkLayerProps[],
    @ShopifySession() session: Session,
  ) {
    try {
      const shopDomain = session.shop;
      const job = await this.createWatermarkJob.execute({
        shopDomain,
        productId: String(productId ?? ""),
        layers,
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

  @Get("templates")
  async listTemplates(@ShopifySession() session: Session) {
    try {
      const shop = await this.prisma.shop.findUnique({
        where: { domain: session.shop },
      });
      if (!shop) return { templates: [] };

      const templates = await this.prisma.watermarkTemplate.findMany({
        where: { shopId: shop.id },
        orderBy: { createdAt: "desc" },
      });

      return {
        templates: templates.map((t) => ({
          id: t.id,
          name: t.name,
          config: normalizeTemplateConfig(t.config),
          isDefault: t.isDefault,
          createdAt: t.createdAt,
        })),
      };
    } catch (error) {
      throw toHttpException("Watermark", error);
    }
  }

  @Post("templates")
  async createTemplate(
    @Body("name") name: unknown,
    @Body("config") config: unknown,
    @Body("isDefault") isDefault: unknown,
    @ShopifySession() session: Session,
  ) {
    try {
      const shop = await this.prisma.shop.findUnique({
        where: { domain: session.shop },
      });
      if (!shop) throw new Error("Shop không tồn tại");

      const templateName = String(name || "Mẫu watermark").trim();
      // Kiểm tra bằng domain và luôn lưu dạng v2 `{ version, layers }`.
      const configStr = JSON.stringify(WatermarkDesign.fromJSON(config).toJSON());
      const makeDefault = Boolean(isDefault);

      if (makeDefault) {
        await this.prisma.watermarkTemplate.updateMany({
          where: { shopId: shop.id },
          data: { isDefault: false },
        });
      }

      const template = await this.prisma.watermarkTemplate.create({
        data: {
          shopId: shop.id,
          name: templateName,
          config: configStr,
          isDefault: makeDefault,
        },
      });

      return {
        template: {
          id: template.id,
          name: template.name,
          config: normalizeTemplateConfig(template.config),
          isDefault: template.isDefault,
          createdAt: template.createdAt,
        },
      };
    } catch (error) {
      throw toHttpException("Watermark", error, HttpStatus.BAD_REQUEST);
    }
  }

  @Delete("templates/:id")
  @HttpCode(HttpStatus.OK)
  async deleteTemplate(
    @Param("id") id: string,
    @ShopifySession() session: Session,
  ) {
    try {
      const shop = await this.prisma.shop.findUnique({
        where: { domain: session.shop },
      });
      if (!shop) throw new Error("Shop không tồn tại");

      await this.prisma.watermarkTemplate.deleteMany({
        where: { id, shopId: shop.id },
      });

      return { success: true };
    } catch (error) {
      throw toHttpException("Watermark", error, HttpStatus.BAD_REQUEST);
    }
  }

  @Post("templates/:id/set-default")
  @HttpCode(HttpStatus.OK)
  async setDefaultTemplate(
    @Param("id") id: string,
    @ShopifySession() session: Session,
  ) {
    try {
      const shop = await this.prisma.shop.findUnique({
        where: { domain: session.shop },
      });
      if (!shop) throw new Error("Shop không tồn tại");

      await this.prisma.$transaction([
        this.prisma.watermarkTemplate.updateMany({
          where: { shopId: shop.id },
          data: { isDefault: false },
        }),
        this.prisma.watermarkTemplate.updateMany({
          where: { id, shopId: shop.id },
          data: { isDefault: true },
        }),
      ]);

      return { success: true };
    } catch (error) {
      throw toHttpException("Watermark", error, HttpStatus.BAD_REQUEST);
    }
  }
}

function toResponse(job: WatermarkJob) {
  return {
    id: job.id,
    productId: job.productId,
    layers: job.design.toJSON().layers,
    summary: job.design.summary,
    status: job.status,
    resultMediaId: job.resultMediaId,
    resultUrl: job.resultMediaId ? `/api/media/assets/${job.resultMediaId}/content` : null,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
  };
}

/** Template cũ (v1, cấu hình phẳng) được đọc thành design một lớp. */
function normalizeTemplateConfig(raw: string) {
  try {
    return WatermarkDesign.fromJSON(raw).toJSON();
  } catch {
    return null;
  }
}
