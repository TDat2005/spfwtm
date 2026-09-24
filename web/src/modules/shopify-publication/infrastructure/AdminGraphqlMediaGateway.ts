import type { Session } from "@shopify/shopify-api";

import type {
  PublishMediaInput,
  PublishedMediaResult,
  ShopifyMediaGateway,
} from "../application/ShopifyMediaGateway.ts";

interface ShopifyGraphqlClient {
  request<T>(
    query: string,
    options?: {
      variables?: Record<string, unknown>;
    }
  ): Promise<{
    data?: T;
  }>;
}

interface ShopifyApiContext {
  api: {
    clients: {
      Graphql: new (options: { session: Session }) => ShopifyGraphqlClient;
    };
  };
}
interface StagedUploadTarget {
  url: string;
  resourceUrl: string;
  parameters: Array<{
    name: string;
    value: string;
  }>;
}

interface StagedUploadResponse {
  stagedUploadsCreate: {
    stagedTargets: StagedUploadTarget[];
    userErrors: Array<{
      field: string[] | null;
      message: string;
    }>;
  };
}

interface ProductUpdateResponse {
  productUpdate: {
    product: {
      id: string;
      media: {
        nodes: Array<{
          id: string;
          status: string;
          image?: {
            url: string;
          } | null;
        }>;
      };
    } | null;

    userErrors: Array<{
      field: string[] | null;
      message: string;
    }>;
  };
}

interface ProductReorderMediaResponse {
  productReorderMedia: {
    job: {
      id: string;
    } | null;
    mediaUserErrors: Array<{
      field: string[] | null;
      message: string;
    }>;
  };
}
export class AdminGraphqlMediaGateway implements ShopifyMediaGateway {
  constructor(
    private readonly shopify: ShopifyApiContext,
    private readonly session: Session
  ) {}

  async publish(input: PublishMediaInput): Promise<PublishedMediaResult> {
    const client = new this.shopify.api.clients.Graphql({
      session: this.session,
    });

    const stagedTarget = await this.createStagedUpload(client, input);

    await this.uploadToStagedTarget(stagedTarget, input);

    return this.attachToProduct(
      client,
      stagedTarget.resourceUrl,
      input
    );
  }

  private async createStagedUpload(
    client: ShopifyGraphqlClient,
    input: PublishMediaInput
  ): Promise<StagedUploadTarget> {
    const result = await client.request<StagedUploadResponse>(
      `
          mutation CreateStagedUpload(
            $input: [StagedUploadInput!]!
          ) {
            stagedUploadsCreate(input: $input) {
              stagedTargets {
                url
                resourceUrl
                parameters {
                  name
                  value
                }
              }
              userErrors {
                field
                message
              }
            }
          }
        `,
      {
        variables: {
          input: [
            {
              resource: "IMAGE",
              filename: input.filename,
              mimeType: input.mimeType,
              httpMethod: "POST",
              fileSize: String(input.bytes.length),
            },
          ],
        },
      }
    );

    if (!result.data) {
      throw new Error("Shopify không trả về staged upload data");
    }

    const payload = result.data.stagedUploadsCreate;

    throwOnUserErrors(payload.userErrors);

    const target = payload.stagedTargets[0];

    if (!target) {
      throw new Error("Shopify không tạo staged upload target");
    }

    return target;
  }

  private async uploadToStagedTarget(
    target: StagedUploadTarget,
    input: PublishMediaInput
  ): Promise<void> {
    const form = new FormData();

    for (const parameter of target.parameters) {
      form.append(parameter.name, parameter.value);
    }

    form.append(
      "file",
      new Blob([new Uint8Array(input.bytes)], {
        type: input.mimeType,
      }),
      input.filename
    );

    const response = await fetch(target.url, {
      method: "POST",
      body: form,
    });

    if (!response.ok) {
      const responseBody = await response.text();

      throw new Error(
        `Không upload được ảnh lên Shopify: ` +
          `HTTP ${response.status} ${responseBody}`
      );
    }
  }

  private async attachToProduct(
    client: ShopifyGraphqlClient,
    resourceUrl: string,
    input: PublishMediaInput
  ): Promise<PublishedMediaResult> {
    const result = await client.request<ProductUpdateResponse>(
      `
          mutation AttachProductMedia(
            $product: ProductUpdateInput!
            $media: [CreateMediaInput!]
          ) {
            productUpdate(
              product: $product
              media: $media
            ) {
              product {
                id
                media(first: 1, reverse: true) {
                  nodes {
                    id
                    status
                    ... on MediaImage {
                      image {
                        url
                      }
                    }
                  }
                }
              }
              userErrors {
                field
                message
              }
            }
          }
        `,
      {
        variables: {
          product: {
            id: input.productId,
          },
          media: [
            {
              mediaContentType: "IMAGE",
              originalSource: resourceUrl,
              alt: input.altText,
            },
          ],
        },
      }
    );

    if (!result.data) {
      throw new Error("Shopify không trả về product update data");
    }

    const payload = result.data.productUpdate;

    throwOnUserErrors(payload.userErrors);

    const media = payload.product?.media.nodes[0];

    if (!media) {
      throw new Error("Shopify không trả về media vừa tạo");
    }

    return {
      mediaId: media.id,
      imageUrl: media.image?.url ?? null,
    };
  }

  async promoteMedia(
    productId: string,
    mediaId: string
  ): Promise<void> {
    const client = new this.shopify.api.clients.Graphql({
      session: this.session,
    });

    const result = await client.request<ProductReorderMediaResponse>(
      `
        mutation ReorderProductMedia(
          $id: ID!
          $moves: [MoveInput!]!
        ) {
          productReorderMedia(
            id: $id
            moves: $moves
          ) {
            job {
              id
            }
            mediaUserErrors {
              field
              message
            }
          }
        }
      `,
      {
        variables: {
          id: productId,
          moves: [
            {
              id: mediaId,
              newPosition: "0",
            },
          ],
        },
      }
    );

    if (!result.data) {
      throw new Error("Shopify không trả về kết quả sắp xếp media");
    }

    throwOnUserErrors(
      result.data.productReorderMedia.mediaUserErrors
    );
  }

  async deleteMedia(productId: string, mediaIds: string[]): Promise<void> {
    if (mediaIds.length === 0) return;
    const client = new this.shopify.api.clients.Graphql({
      session: this.session,
    });

    const result = await client.request<{
      productDeleteMedia: {
        deletedMediaIds: string[];
        userErrors: Array<{
          field: string[] | null;
          message: string;
        }>;
      };
    }>(
      `
        mutation ProductDeleteMedia(
          $productId: ID!
          $mediaIds: [ID!]!
        ) {
          productDeleteMedia(
            productId: $productId
            mediaIds: $mediaIds
          ) {
            deletedMediaIds
            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        variables: {
          productId,
          mediaIds,
        },
      }
    );

    if (!result.data) {
      throw new Error("Shopify không trả về kết quả xóa media");
    }

    throwOnUserErrors(result.data.productDeleteMedia.userErrors);
  }
}
function throwOnUserErrors(
  errors: Array<{
    field: string[] | null;
    message: string;
  }>
): void {
  if (errors.length === 0) {
    return;
  }

  const message = errors
    .map((error) => {
      const field = error.field?.join(".") ?? "unknown";

      return `${field}: ${error.message}`;
    })
    .join("; ");

  throw new Error(`Shopify API: ${message}`);
}
