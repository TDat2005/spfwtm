import { describe, expect, it, vi } from "vitest";
import {
  RestoreProductOriginal,
  planCatalogUpdate,
  type AppMediaRegistry,
  type CatalogRestoreWriter,
  type CatalogSourceState,
  type ProductMediaReader,
  type ProductMediaSnapshot,
} from "./RestoreProductOriginal.ts";

const SHOP = "test.myshopify.com";
const PRODUCT = "gid://shopify/Product/1";

const ORIGINAL = media("gid://shopify/MediaImage/100", "https://cdn.shopify.com/original.jpg");
// File của merchant tình cờ đặt tên giống ảnh watermark của app.
const MERCHANT_WM_NAMED = media("gid://shopify/MediaImage/101", "https://cdn.shopify.com/files/wm-logo.png");
const MERCHANT_OTHER = media("gid://shopify/MediaImage/102", "https://cdn.shopify.com/other.jpg");
const APP_PUBLISHED = media("gid://shopify/MediaImage/200", "https://cdn.shopify.com/wm-200.webp");
const APP_ATTEMPT_ONLY = media("gid://shopify/MediaImage/201", "https://cdn.shopify.com/wm-201.webp");

function media(id: string, imageUrl: string | null): ProductMediaSnapshot {
  return { id, imageUrl };
}

interface Scenario {
  appMediaIds: string[];
  /** Media đang có trên Shopify, theo thứ tự vị trí. */
  live: ProductMediaSnapshot[];
  source?: CatalogSourceState | null;
  /** Thay thế hành vi xóa; `removeFromLive` mô phỏng việc Shopify đã xóa media. */
  deleteMedia?: (
    removeFromLive: (ids: string[]) => void,
    mediaIds: string[],
  ) => Promise<void>;
}

function setup(scenario: Scenario) {
  let live = [...scenario.live];
  const forgotten: string[] = [];

  const appMedia: AppMediaRegistry = {
    listAppMediaIds: vi.fn(async () => scenario.appMediaIds),
    forgetPublishedMedia: vi.fn(async (_shop, _product, ids: string[]) => {
      forgotten.push(...ids);
    }),
  };
  const reader: ProductMediaReader = {
    listMedia: vi.fn(async () => live),
    readPrimaryImage: vi.fn(async () => live[0] ?? null),
  };
  const removeFromLive = (ids: string[]) => {
    live = live.filter((item) => !ids.includes(item.id));
  };
  const deleteMedia = vi.fn(async (_productId: string, mediaIds: string[]) => {
    if (scenario.deleteMedia) return scenario.deleteMedia(removeFromLive, mediaIds);
    removeFromLive(mediaIds);
  });
  const source =
    scenario.source === undefined
      ? { sourceMediaId: ORIGINAL.id, originalImageUrl: ORIGINAL.imageUrl }
      : scenario.source;
  const catalog: CatalogRestoreWriter = {
    findSource: vi.fn(async () => source),
    applyRestore: vi.fn().mockResolvedValue(undefined),
  };

  const useCase = new RestoreProductOriginal(appMedia, reader, { deleteMedia }, catalog);
  return { useCase, appMedia, reader, deleteMedia, catalog, forgotten };
}

function deletedIds(deleteMedia: ReturnType<typeof setup>["deleteMedia"]): string[] {
  return deleteMedia.mock.calls.flatMap(([, ids]) => ids);
}

describe("RestoreProductOriginal", () => {
  it("không bao giờ xóa ảnh của merchant, kể cả ảnh gốc và file tên wm-*", async () => {
    const { useCase, deleteMedia, forgotten } = setup({
      appMediaIds: [APP_PUBLISHED.id],
      live: [APP_PUBLISHED, ORIGINAL, MERCHANT_WM_NAMED, MERCHANT_OTHER],
    });

    const result = await useCase.execute({ productId: PRODUCT, shopDomain: SHOP });

    expect(deleteMedia).toHaveBeenCalledTimes(1);
    expect(deleteMedia).toHaveBeenCalledWith(PRODUCT, [APP_PUBLISHED.id]);
    const deleted = deletedIds(deleteMedia);
    expect(deleted).not.toContain(ORIGINAL.id);
    expect(deleted).not.toContain(MERCHANT_WM_NAMED.id);
    expect(deleted).not.toContain(MERCHANT_OTHER.id);
    expect(forgotten).toEqual([APP_PUBLISHED.id]);
    expect(result.deletedMediaIds).toEqual([APP_PUBLISHED.id]);
    expect(result.restoredImageUrl).toBe(ORIGINAL.imageUrl);
  });

  it("xóa media của app từ cả PublishedMedia lẫn PublicationAttempt, gộp thành một lần gọi", async () => {
    const { useCase, deleteMedia, forgotten } = setup({
      // Sổ trả về id từ PublishedMedia và từ PublicationAttempt (publish crash giữa chừng), có trùng lặp.
      appMediaIds: [APP_PUBLISHED.id, APP_ATTEMPT_ONLY.id, APP_PUBLISHED.id],
      live: [APP_PUBLISHED, APP_ATTEMPT_ONLY, ORIGINAL, MERCHANT_WM_NAMED],
    });

    const result = await useCase.execute({ productId: PRODUCT, shopDomain: SHOP });

    expect(deleteMedia).toHaveBeenCalledTimes(1);
    expect(deleteMedia).toHaveBeenCalledWith(PRODUCT, [APP_PUBLISHED.id, APP_ATTEMPT_ONLY.id]);
    expect(forgotten).toEqual([APP_PUBLISHED.id, APP_ATTEMPT_ONLY.id]);
    expect(result.deletedMediaIds).toEqual([APP_PUBLISHED.id, APP_ATTEMPT_ONLY.id]);
  });

  it("không xóa gì khi sản phẩm không có media của app, dù ảnh gốc là ảnh duy nhất hoặc tên wm-*", async () => {
    const { useCase, deleteMedia, appMedia } = setup({
      appMediaIds: [],
      live: [MERCHANT_WM_NAMED, ORIGINAL],
    });

    const result = await useCase.execute({ productId: PRODUCT, shopDomain: SHOP });

    expect(deleteMedia).not.toHaveBeenCalled();
    expect(appMedia.forgetPublishedMedia).not.toHaveBeenCalled();
    expect(result.deletedMediaIds).toEqual([]);
  });

  it("không xóa ảnh gốc ngay cả khi sổ ghi nhầm id của nó (sourceMediaId)", async () => {
    const { useCase, deleteMedia, forgotten } = setup({
      appMediaIds: [ORIGINAL.id, APP_PUBLISHED.id],
      live: [APP_PUBLISHED, ORIGINAL],
    });

    const result = await useCase.execute({ productId: PRODUCT, shopDomain: SHOP });

    expect(deleteMedia).toHaveBeenCalledWith(PRODUCT, [APP_PUBLISHED.id]);
    expect(deletedIds(deleteMedia)).not.toContain(ORIGINAL.id);
    expect(forgotten).toEqual([APP_PUBLISHED.id]);
    expect(result.protectedMediaIds).toEqual([ORIGINAL.id]);
  });

  it("media của app đã biến mất khỏi Shopify thì chỉ dọn bản ghi, không gọi xóa", async () => {
    const { useCase, deleteMedia, forgotten } = setup({
      appMediaIds: [APP_PUBLISHED.id],
      live: [ORIGINAL],
    });

    const result = await useCase.execute({ productId: PRODUCT, shopDomain: SHOP });

    expect(deleteMedia).not.toHaveBeenCalled();
    expect(forgotten).toEqual([APP_PUBLISHED.id]);
    expect(result.alreadyRemovedMediaIds).toEqual([APP_PUBLISHED.id]);
  });

  it("Shopify báo lỗi khi xóa: ném lỗi và giữ bản ghi của media chưa bị xóa", async () => {
    const { useCase, appMedia, forgotten, catalog } = setup({
      appMediaIds: [APP_PUBLISHED.id],
      live: [APP_PUBLISHED, ORIGINAL],
      deleteMedia: async () => {
        throw new Error("Shopify không xóa được ảnh của sản phẩm: mediaIds: không có quyền");
      },
    });

    await expect(useCase.execute({ productId: PRODUCT, shopDomain: SHOP })).rejects.toThrow(
      "Shopify không xóa được ảnh",
    );

    expect(forgotten).toEqual([]);
    expect(appMedia.forgetPublishedMedia).not.toHaveBeenCalled();
    expect(catalog.applyRestore).not.toHaveBeenCalled();
  });

  it("xóa một phần rồi lỗi: chỉ quên bản ghi của media đã thật sự biến mất", async () => {
    const { useCase, forgotten } = setup({
      appMediaIds: [APP_PUBLISHED.id, APP_ATTEMPT_ONLY.id],
      live: [APP_PUBLISHED, APP_ATTEMPT_ONLY, ORIGINAL],
      deleteMedia: async (removeFromLive) => {
        removeFromLive([APP_PUBLISHED.id]);
        throw new Error("Shopify không xóa được ảnh: mediaIds: lỗi một phần");
      },
    });

    await expect(useCase.execute({ productId: PRODUCT, shopDomain: SHOP })).rejects.toThrow(
      "lỗi một phần",
    );

    expect(forgotten).toEqual([APP_PUBLISHED.id]);
  });

  it("không có dòng catalog thì không cập nhật catalog nhưng vẫn trả URL ảnh chính", async () => {
    const { useCase, catalog } = setup({
      appMediaIds: [APP_PUBLISHED.id],
      live: [APP_PUBLISHED, ORIGINAL],
      source: null,
    });

    const result = await useCase.execute({ productId: PRODUCT, shopDomain: SHOP });

    expect(catalog.applyRestore).not.toHaveBeenCalled();
    expect(result.restoredImageUrl).toBe(ORIGINAL.imageUrl);
  });

  it("giữ nguồn khi ảnh gốc vẫn là ảnh chính sau khi xóa ảnh của app", async () => {
    const { useCase, catalog } = setup({
      appMediaIds: [APP_PUBLISHED.id],
      live: [APP_PUBLISHED, ORIGINAL, MERCHANT_OTHER],
    });

    await useCase.execute({ productId: PRODUCT, shopDomain: SHOP });

    expect(catalog.applyRestore).toHaveBeenCalledWith(SHOP, PRODUCT, {
      kind: "ORIGINAL_INTACT",
      imageUrl: ORIGINAL.imageUrl,
    });
  });

  it("từ chối productId hoặc shopDomain rỗng", async () => {
    const { useCase } = setup({ appMediaIds: [], live: [] });

    await expect(useCase.execute({ productId: " ", shopDomain: SHOP })).rejects.toThrow("productId");
    await expect(useCase.execute({ productId: PRODUCT, shopDomain: "" })).rejects.toThrow("shopDomain");
  });
});

describe("planCatalogUpdate", () => {
  const source: CatalogSourceState = {
    sourceMediaId: ORIGINAL.id,
    originalImageUrl: ORIGINAL.imageUrl,
  };

  it("ảnh chính trùng sourceMediaId: chỉ làm mới URL, không đổi nguồn", () => {
    expect(planCatalogUpdate(source, media(ORIGINAL.id, "https://cdn.shopify.com/original.jpg?v=2"))).toEqual({
      kind: "ORIGINAL_INTACT",
      imageUrl: "https://cdn.shopify.com/original.jpg?v=2",
    });
  });

  it("ảnh chính chưa có URL thì dùng lại originalImageUrl của cùng ảnh gốc", () => {
    expect(planCatalogUpdate(source, media(ORIGINAL.id, null))).toEqual({
      kind: "ORIGINAL_INTACT",
      imageUrl: ORIGINAL.imageUrl,
    });
  });

  it("ảnh chính là ảnh khác của merchant: nhận làm nguồn mới và đánh dấu nguồn đã đổi", () => {
    expect(planCatalogUpdate(source, MERCHANT_OTHER)).toEqual({
      kind: "SOURCE_ADOPTED",
      mediaId: MERCHANT_OTHER.id,
      imageUrl: MERCHANT_OTHER.imageUrl,
      sourceChanged: true,
    });
  });

  it("chưa có nguồn trước đó: nhận ảnh chính làm nguồn, không tăng version", () => {
    expect(
      planCatalogUpdate({ sourceMediaId: null, originalImageUrl: null }, MERCHANT_OTHER),
    ).toMatchObject({ kind: "SOURCE_ADOPTED", sourceChanged: false });
  });

  it("không còn ảnh nào: không giữ URL ảnh đã mất", () => {
    expect(planCatalogUpdate(source, null)).toEqual({ kind: "NO_IMAGE", hadSource: true });
    expect(planCatalogUpdate(null, null)).toEqual({ kind: "NO_IMAGE", hadSource: false });
  });
});
