import type { PublishedMedia } from "../domain/PublishedMedia.ts";
export interface PublishedMediaRepository {
    save(media: PublishedMedia): Promise<void>;
    findByJobId(watermarkJobId: string, shopDomain: string): Promise<PublishedMedia | null>;

    listByShop(shopDomain: string): Promise<PublishedMedia[]>;
    delete(id: string): Promise<void>;
}