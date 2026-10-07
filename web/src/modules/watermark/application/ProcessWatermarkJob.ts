import type {
  WatermarkJobRepository,
  WatermarkMediaGateway,
  WatermarkProcessor,
} from "./WatermarkPorts.ts";

interface ProcessWatermarkJobOptions {
  resumeProcessing?: boolean;
}

export class ProcessWatermarkJob {
  constructor(
    private readonly repository: WatermarkJobRepository,
    private readonly media: WatermarkMediaGateway,
    private readonly processor: WatermarkProcessor
  ) {}

  async execute(
    jobId: string,
    shopDomain: string,
    options: ProcessWatermarkJobOptions = {}
  ) {
    const job = await this.repository.findByIdForShop(jobId, shopDomain);
    if (!job) throw new Error("Không tìm thấy watermark job");

    if (
      job.status === "COMPLETED" ||
      job.status === "CANCELLED" ||
      (job.status === "PROCESSING" && !options.resumeProcessing)
    ) {
      return job;
    }

    if (job.status === "FAILED") job.retry();

    if (job.status === "PENDING") {
      job.start();
      await this.repository.save(job);
    }

    try {
      const source = await this.media.importSource(
        shopDomain,
        job.sourceImageUrl
      );

      const logos = new Map<string, Buffer>();
      for (const logoUrl of job.design.logoUrls) {
        logos.set(logoUrl, await this.media.importLogo(shopDomain, logoUrl));
      }
      const result = await this.processor.render({
        source,
        design: job.design,
        logos,
      });

      const resultMediaId = await this.media.storeResult(
        shopDomain,
        result.bytes,
        result.mimeType
      );
      job.complete(resultMediaId);
      await this.repository.save(job);
      return job;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Không xử lý được watermark";
      job.fail(message);
      await this.repository.save(job);
      throw error;
    }
  }
}
