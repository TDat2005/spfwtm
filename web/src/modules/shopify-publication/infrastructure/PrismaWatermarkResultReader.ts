import type { PrismaClient } from "../../../generated/prisma/client.ts";

import type { MediaStorage } from "../../media/application/MediaPorts.ts";
import type {
    WatermarkResult,
    WatermarkResultReader,
} from "../application/WatermarkResultReader.ts";

export class PrismaWatermarkResultReader
    implements WatermarkResultReader {
    constructor(
        private readonly prisma: PrismaClient,
        private readonly mediaStorage: MediaStorage,
    ) { }

    async read(
        watermarkJobId: string,
        shopDomain: string,
    ): Promise<WatermarkResult | null> {
        const job = await this.prisma.watermarkJob.findFirst({
            where: {
                id: watermarkJobId,
                status: "COMPLETED",
                shop: {
                    domain: shopDomain,
                },
            },
            include: {
                product: true,
                resultMedia: true,
            },
        });

        if (!job || !job.resultMedia) {
            return null;
        }

        const bytes = await this.mediaStorage.read(
            job.resultMedia.storageKey,
        );

        return {
            productId: job.product.shopifyProductId,
            bytes,
            mimeType: job.resultMedia.mimeType,
        };
    }
}