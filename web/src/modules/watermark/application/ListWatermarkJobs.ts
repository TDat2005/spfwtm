import type { WatermarkJob } from "../domain/WatermarkJob.ts";
import type { WatermarkJobRepository } from "./WatermarkPorts.ts";

export class ListWatermarkJobs {
  constructor(private readonly repository: WatermarkJobRepository) {}

  async execute(shopDomain: string): Promise<WatermarkJob[]> {
    if (!shopDomain.trim()) throw new Error("Shop domain không được để trống");
    return this.repository.listByShop(shopDomain);
  }
}
