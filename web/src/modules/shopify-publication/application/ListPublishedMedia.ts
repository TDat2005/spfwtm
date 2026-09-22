import type { PublishedMedia } from "../domain/PublishedMedia.ts";
import type { PublishedMediaRepository } from "./PublishedMediaRepository.ts";

export class ListPublishedMedia {
    constructor(
        private readonly repository: PublishedMediaRepository,
    ) { }

    async execute(
        shopDomain: string,
    ): Promise<PublishedMedia[]> {
        if (!shopDomain.trim()) {
            throw new Error("Shop domain không được để trống");
        }

        return this.repository.listByShop(shopDomain);
    }
}