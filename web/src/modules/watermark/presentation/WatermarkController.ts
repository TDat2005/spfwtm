import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Post, Query } from "@nestjs/common";
import { CurrentShop } from "../../../shared/nest/CurrentShop.ts";
import { toHttpException } from "../../../shared/nest/toHttpException.ts";
import { JOB_PRIORITY } from "../../jobs/domain/JobDefinitions.ts";
import { CancelWatermarkBatch } from "../application/CancelWatermarkBatch.ts";
import { CancelWatermarkJob } from "../application/CancelWatermarkJob.ts";
import { CreateFilteredWatermarkBatches } from "../application/CreateFilteredWatermarkBatches.ts";
import { CreateWatermarkBatch } from "../application/CreateWatermarkBatch.ts";
import { CreateWatermarkJob } from "../application/CreateWatermarkJob.ts";
import { EnqueueWatermarkJob } from "../application/EnqueueWatermarkJob.ts";
import { GetWatermarkJob } from "../application/GetWatermarkJob.ts";
import {
  ListStudioProducts,
  MAX_STUDIO_PRODUCTS_PAGE_SIZE,
  STUDIO_PRODUCTS_PAGE_SIZE,
} from "../application/ListStudioProducts.ts";
import { ListWatermarkBatches } from "../application/ListWatermarkBatches.ts";
import {
  ListWatermarkJobs,
  MAX_WATERMARK_JOBS_PAGE_SIZE,
  WATERMARK_JOBS_PAGE_SIZE,
} from "../application/ListWatermarkJobs.ts";
import { ProcessWatermarkJob } from "../application/ProcessWatermarkJob.ts";
import { RetryWatermarkJob } from "../application/RetryWatermarkJob.ts";
import { WatermarkDesign, type WatermarkLayerProps } from "../domain/WatermarkDesign.ts";
import type { WatermarkJob } from "../domain/WatermarkJob.ts";
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import { PRISMA_CLIENT } from "../../../shared/nest/tokens.ts";
import {
  BatchSelectionPipe,
  WatermarkLayersPipe,
  parseCatalogFilterQuery,
  parsePageQuery,
  type BatchRequestSelection,
} from "./WatermarkPipes.ts";

@Controller("api/watermarks")
export class WatermarkController {
  constructor(
    @Inject(CreateWatermarkJob) private readonly createWatermarkJob: CreateWatermarkJob,
    @Inject(ListWatermarkJobs) private readonly listWatermarkJobs: ListWatermarkJobs,
    @Inject(ListStudioProducts) private readonly listStudioProducts: ListStudioProducts,
    @Inject(GetWatermarkJob) private readonly getWatermarkJob: GetWatermarkJob,
    @Inject(RetryWatermarkJob) private readonly retryWatermarkJob: RetryWatermarkJob,
    @Inject(CancelWatermarkJob) private readonly cancelWatermarkJob: CancelWatermarkJob,
    @Inject(ProcessWatermarkJob) private readonly processWatermarkJob: ProcessWatermarkJob,
    @Inject(CreateWatermarkBatch) private readonly createWatermarkBatch: CreateWatermarkBatch,
    @Inject(CreateFilteredWatermarkBatches)
    private readonly createFilteredBatches: CreateFilteredWatermarkBatches,
    @Inject(ListWatermarkBatches) private readonly listWatermarkBatches: ListWatermarkBatches,
    @Inject(CancelWatermarkBatch) private readonly cancelWatermarkBatch: CancelWatermarkBatch,
    @Inject(EnqueueWatermarkJob) private readonly enqueueWatermarkJob: EnqueueWatermarkJob,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  /** Bảng sản phẩm của studio: một trang sản phẩm có ảnh khớp bộ lọc. */
  @Get("products")
  async listProducts(@Query() query: Record<string, unknown>, @CurrentShop() shopDomain: string) {
    const filter = parseCatalogFilterQuery(query);
    const { page, pageSize } = parsePageQuery(
      query,
      STUDIO_PRODUCTS_PAGE_SIZE,
      MAX_STUDIO_PRODUCTS_PAGE_SIZE,
    );
    try {
      return await this.listStudioProducts.execute({ shopDomain, filter, page, pageSize });
    } catch (error) {
      throw toHttpException("Watermark", error);
    }
  }

  @Get("jobs")
  async listJobs(@Query() query: Record<string, unknown>, @CurrentShop() shopDomain: string) {
    const { page, pageSize } = parsePageQuery(
      query,
      WATERMARK_JOBS_PAGE_SIZE,
      MAX_WATERMARK_JOBS_PAGE_SIZE,
    );
    try {
      const history = await this.listWatermarkJobs.execute(shopDomain, page, pageSize);
      return {
        jobs: history.items.map(({ job, productTitle, published }) => ({
          ...toResponse(job),
          productTitle,
          published,
        })),
        total: history.total,
        page: history.page,
        pageSize: history.pageSize,
      };
    } catch (error) {
      throw toHttpException("Watermark", error);
    }
  }

  @Get("batches")
  async listBatches(@CurrentShop() shopDomain: string) {
    try {
      const batches = await this.listWatermarkBatches.execute(shopDomain);
      return { batches };
    } catch (error) {
      throw toHttpException("Watermark", error);
    }
  }

  @Post("batches")
  async createBatch(
    @Body(BatchSelectionPipe) selection: BatchRequestSelection,
    @Body(WatermarkLayersPipe) layers: WatermarkLayerProps[],
    @CurrentShop() shopDomain: string,
  ) {
    try {
      const batches =
        selection.kind === "FILTER"
          ? await this.createFilteredBatches.execute({
              shopDomain,
              filter: selection.filter,
              layers,
            })
          : [
              await this.createWatermarkBatch.execute({
                shopDomain,
                selection,
                layers,
              }),
            ];
      const summaries = batches.map((batch) => ({
        id: batch.id,
        totalJobs: batch.totalJobs,
        skippedProducts: batch.skippedProducts,
        createdAt: batch.createdAt,
      }));
      // `batch` giữ cho client cũ; bộ lọc lớn hơn 5.000 sản phẩm tạo nhiều batch.
      return { batch: summaries[0], batches: summaries };
    } catch (error) {
      throw toHttpException("Watermark", error, HttpStatus.BAD_REQUEST);
    }
  }

  @Post("batches/:id/cancel")
  @HttpCode(HttpStatus.OK)
  async cancelBatch(@Param("id") id: string, @CurrentShop() shopDomain: string) {
    try {
      await this.cancelWatermarkBatch.execute(id, shopDomain);
      return { success: true };
    } catch (error) {
      throw toHttpException("Watermark", error, HttpStatus.BAD_REQUEST);
    }
  }

  @Post("jobs")
  async createJob(
    @Body("productId") productId: unknown,
    @Body(WatermarkLayersPipe) layers: WatermarkLayerProps[],
    @CurrentShop() shopDomain: string,
  ) {
    try {
      const job = await this.createWatermarkJob.execute({
        shopDomain,
        productId: String(productId ?? ""),
        layers,
      });
      await this.enqueueWatermarkJob.execute({
        jobId: job.id,
        shopDomain,
        priority: JOB_PRIORITY.URGENT,
      });
      return { job: toResponse(job) };
    } catch (error) {
      throw toHttpException("Watermark", error, HttpStatus.BAD_REQUEST);
    }
  }

  @Get("jobs/:id")
  async getJob(@Param("id") id: string, @CurrentShop() shopDomain: string) {
    try {
      const job = await this.getWatermarkJob.execute(id, shopDomain);
      return { job: toResponse(job) };
    } catch (error) {
      throw toHttpException("Watermark", error, HttpStatus.NOT_FOUND);
    }
  }

  @Post("jobs/:id/retry")
  @HttpCode(HttpStatus.ACCEPTED)
  async retryJob(@Param("id") id: string, @CurrentShop() shopDomain: string) {
    try {
      const job = await this.retryWatermarkJob.execute(id, shopDomain);
      await this.enqueueWatermarkJob.execute({
        jobId: job.id,
        shopDomain,
        priority: JOB_PRIORITY.URGENT,
      });
      return { job: toResponse(job) };
    } catch (error) {
      throw toHttpException("Watermark", error, HttpStatus.BAD_REQUEST);
    }
  }

  @Post("jobs/:id/cancel")
  @HttpCode(HttpStatus.OK)
  async cancelJob(@Param("id") id: string, @CurrentShop() shopDomain: string) {
    try {
      const job = await this.cancelWatermarkJob.execute(id, shopDomain);
      return { job: toResponse(job) };
    } catch (error) {
      throw toHttpException("Watermark", error, HttpStatus.BAD_REQUEST);
    }
  }

  @Post("jobs/:id/process")
  @HttpCode(HttpStatus.OK)
  async processJob(@Param("id") id: string, @CurrentShop() shopDomain: string) {
    try {
      const job = await this.processWatermarkJob.execute(id, shopDomain);
      return { job: toResponse(job) };
    } catch (error) {
      throw toHttpException("Watermark", error);
    }
  }

  @Get("templates")
  async listTemplates(@CurrentShop() shopDomain: string) {
    try {
      const shop = await this.prisma.shop.findUnique({
        where: { domain: shopDomain },
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
    @CurrentShop() shopDomain: string,
  ) {
    try {
      const shop = await this.prisma.shop.findUnique({
        where: { domain: shopDomain },
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
    @CurrentShop() shopDomain: string,
  ) {
    try {
      const shop = await this.prisma.shop.findUnique({
        where: { domain: shopDomain },
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
    @CurrentShop() shopDomain: string,
  ) {
    try {
      const shop = await this.prisma.shop.findUnique({
        where: { domain: shopDomain },
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
