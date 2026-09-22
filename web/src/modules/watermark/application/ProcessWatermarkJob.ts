import type {
  WatermarkJobRepository,
  WatermarkMediaGateway,
  WatermarkProcessor,
} from "./WatermarkPorts.ts";

export class ProcessWatermarkJob {
  constructor(
    private readonly repository: WatermarkJobRepository,
    private readonly media: WatermarkMediaGateway,
    private readonly processor: WatermarkProcessor
  ) {}

  async execute(jobId: string, shopDomain: string) {
    const job = await this.repository.findByIdForShop(jobId, shopDomain);
    if (!job) throw new Error("Không tìm thấy watermark job");

    job.start();
    await this.repository.save(job);

    try {
      const source = await this.media.importSource(
        shopDomain,
        job.sourceImageUrl
      );

      let result: { bytes: Buffer; mimeType: string };

      if (job.watermarkType === "IMAGE" && job.logoUrl) {
        const logo = await this.media.importSource(
          shopDomain,
          job.logoUrl
        );
        result = await this.processor.applyImage({
          source,
          logo,
          position: job.position,
          opacity: job.opacity,
          scale: job.logoScale,
        });
      } else {
        result = await this.processor.applyText({
          source,
          text: job.text ?? "",
          position: job.position,
          opacity: job.opacity,
        });
      }

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
