import type { EnqueueJobInput } from "../../jobs/application/EnqueueJob.ts";
import { PUBLICATION_PUBLISH_V1 } from "../../jobs/domain/JobDefinitions.ts";

/**
 * Job publish ảnh watermark của batch lên Shopify. Dùng chung cho nút
 * "Publish tất cả" và cho job xong sau khi merchant đã bấm nút đó.
 *
 * - replacePrevious: gỡ ảnh watermark cũ của app trên sản phẩm (không đụng ảnh
 *   gốc của merchant), để chạy batch nhiều lần không chồng nhiều ảnh.
 * - onlyIfNewest: sản phẩm đã có ảnh watermark mới hơn thì bỏ qua, để publish
 *   lại batch cũ không đè ảnh mới bằng ảnh cũ.
 * - replaceFinished: lần publish trước thất bại thì vẫn thử lại được.
 */
export function batchPublishJob(watermarkJobId: string, shopDomain: string): EnqueueJobInput {
  return {
    ...PUBLICATION_PUBLISH_V1,
    jobId: `publish_${watermarkJobId}`,
    payload: {
      watermarkJobId,
      shopDomain,
      replacePrevious: true,
      onlyIfNewest: true,
    },
    maxAttempts: 5,
    replaceFinished: true,
  };
}
