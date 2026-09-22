import express from "express";
import type {
    Request,
    Response,
} from "express";
import type { Session } from "@shopify/shopify-api";

import type { ListPublishedMedia } from "../application/ListPublishedMedia.ts";
import type { PublishWatermarkedImage } from "../application/PublishWatermarkedImage.ts";
import type { RestoreOriginalImage } from "../application/RestoreOriginalImage.ts";
import type { PublishedMedia } from "../domain/PublishedMedia.ts";

interface PublicationRouterDependencies {
    listPublishedMedia: ListPublishedMedia;

    createPublishWatermarkedImage(
        session: Session,
    ): PublishWatermarkedImage;

    createRestoreOriginalImage(
        session: Session,
    ): RestoreOriginalImage;
}

interface ShopifyLocals
    extends Record<string, unknown> {
    shopify: {
        session: Session;
    };
}
export function createPublicationRouter(
    dependencies: PublicationRouterDependencies,
) {
    const router = express.Router();

    router.get(
        "/",
        async (
            _request: Request,
            response: Response<unknown, ShopifyLocals>,
        ) => {
            try {
                const shopDomain =
                    response.locals.shopify.session.shop;

                const publications =
                    await dependencies.listPublishedMedia.execute(
                        shopDomain,
                    );

                response.status(200).send({
                    publications: publications.map(toResponse),
                });
            } catch (error: unknown) {
                sendError(response, error);
            }
        },
    );

    router.post(
        "/jobs/:jobId",
        async (
            request: Request,
            response: Response<unknown, ShopifyLocals>,
        ) => {
            try {
                const session =
                    response.locals.shopify.session;

                const jobId = Array.isArray(
                    request.params.jobId,
                )
                    ? request.params.jobId[0] ?? ""
                    : request.params.jobId ?? "";

                const body = request.body as {
                    altText?: unknown;
                };

                const useCase =
                    dependencies.createPublishWatermarkedImage(
                        session,
                    );

                const publishedMedia =
                    await useCase.execute({
                        watermarkJobId: jobId,
                        shopDomain: session.shop,
                        altText: String(
                            body.altText ??
                            "Product image with watermark",
                        ),
                    });

                response.status(201).send({
                    publishedMedia:
                        toResponse(publishedMedia),
                });
            } catch (error: unknown) {
                sendError(response, error);
            }
        },
    );

    router.post(
        "/jobs/:jobId/restore",
        async (
            request: Request,
            response: Response<unknown, ShopifyLocals>,
        ) => {
            try {
                const session =
                    response.locals.shopify.session;

                const jobId = Array.isArray(
                    request.params.jobId,
                )
                    ? request.params.jobId[0] ?? ""
                    : request.params.jobId ?? "";

                const useCase =
                    dependencies.createRestoreOriginalImage(
                        session,
                    );

                const result =
                    await useCase.execute({
                        watermarkJobId: jobId,
                        shopDomain: session.shop,
                    });

                response.status(200).send({
                    success: true,
                    result,
                });
            } catch (error: unknown) {
                sendError(response, error);
            }
        },
    );

    return router;
}
function toResponse(media: PublishedMedia) {
    return {
        id: media.id,
        watermarkJobId: media.watermarkJobId,
        productId: media.productId,
        shopifyMediaId: media.shopifyMediaId,
        imageUrl: media.imageUrl,
        createdAt: media.createdAt,
    };
}

function sendError(
    response: Response,
    error: unknown,
): void {
    const message =
        error instanceof Error
            ? error.message
            : "Lỗi không xác định";

    console.error("Publication error:", message);

    response.status(500).send({
        error: message,
    });
}