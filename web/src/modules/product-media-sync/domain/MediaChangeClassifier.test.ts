import { describe, expect, it } from "vitest";
import type { ProductMediaState } from "./ProductMediaChange.ts";
import { MediaChangeClassifier } from "./MediaChangeClassifier.ts";

const triggeredAt = new Date("2026-09-24T03:00:00.000Z");

describe("MediaChangeClassifier", () => {
  const classifier = new MediaChangeClassifier();

  it("bỏ qua khi merchant chỉ sửa title hoặc tag", () => {
    expect(classify(product("source-1"), "source-1")).toBe(
      "SOURCE_UNCHANGED"
    );
  });

  it("bỏ qua ảnh do app đã publish", () => {
    expect(
      classifier.classify({
        ...input(product("app-1"), "source-1"),
        publishedMediaIds: new Set(["app-1"]),
      }).kind
    ).toBe("APP_MEDIA_PUBLISHED");
  });

  it("trì hoãn khi webhook đến trước lúc publish lưu xong media ID", () => {
    expect(
      classifier.classify({
        ...input(product("merchant-2"), "source-1"),
        hasPublicationWithoutMediaId: true,
      }).kind
    ).toBe("APP_PUBLICATION_PENDING");
  });

  it("nhận diện ảnh chính mới do merchant upload", () => {
    const state = product("merchant-new", ["merchant-new", "source-1"]);
    state.primaryMedia = {
      ...state.primaryMedia!,
      createdAt: new Date("2026-09-24T02:59:00.000Z"),
    };
    expect(classify(state, "source-1")).toBe("MERCHANT_PRIMARY_CHANGED");
  });

  it("không render lại khi merchant chỉ reorder ảnh đã có từ trước", () => {
    const state = product("old-gallery-image", ["old-gallery-image", "source-1"]);
    state.primaryMedia = {
      ...state.primaryMedia!,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    expect(classify(state, "source-1")).toBe("MEDIA_REORDERED");
  });

  it("đánh dấu review khi ảnh chính bị xóa", () => {
    const state = product("source-1");
    state.primaryMedia = null;
    state.media = [];
    expect(classify(state, "source-1")).toBe("PRIMARY_REMOVED");
  });

  function classify(
    state: ProductMediaState | null,
    sourceMediaId: string | null
  ) {
    return classifier.classify(input(state, sourceMediaId)).kind;
  }
});

function input(
  state: ProductMediaState | null,
  sourceMediaId: string | null
) {
  return {
    product: state,
    sourceMediaId,
    publishedMediaIds: new Set<string>(),
    publishingMediaIds: new Set<string>(),
    hasPublicationWithoutMediaId: false,
    webhookTriggeredAt: triggeredAt,
  };
}

function product(
  primaryId: string,
  ids: string[] = [primaryId]
): ProductMediaState {
  const media = ids.map((id) => ({
    id,
    imageUrl: `https://cdn.example.com/${id}.jpg`,
    altText: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  }));
  return {
    productId: "gid://shopify/Product/1",
    title: "Demo",
    status: "ACTIVE",
    primaryMedia: media[0] ?? null,
    media,
  };
}
