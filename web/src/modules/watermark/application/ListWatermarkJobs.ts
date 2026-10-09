import type { WatermarkJobHistoryItem, WatermarkJobRepository } from "./WatermarkPorts.ts";

export const WATERMARK_JOBS_PAGE_SIZE = 20;
export const MAX_WATERMARK_JOBS_PAGE_SIZE = 100;

export interface WatermarkJobHistoryPage {
  items: WatermarkJobHistoryItem[];
  total: number;
  page: number;
  pageSize: number;
}

export class ListWatermarkJobs {
  constructor(private readonly repository: WatermarkJobRepository) {}

  async execute(
    shopDomain: string,
    page = 1,
    pageSize = WATERMARK_JOBS_PAGE_SIZE
  ): Promise<WatermarkJobHistoryPage> {
    if (!shopDomain.trim()) throw new Error("Shop domain không được để trống");
    if (!Number.isInteger(page) || page < 1) throw new Error("Số trang phải là số nguyên dương");
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_WATERMARK_JOBS_PAGE_SIZE) {
      throw new Error(`Mỗi trang từ 1 đến ${MAX_WATERMARK_JOBS_PAGE_SIZE} job`);
    }
    const { items, total } = await this.repository.listPageByShop(shopDomain, {
      offset: (page - 1) * pageSize,
      limit: pageSize,
    });
    return { items, total, page, pageSize };
  }
}
