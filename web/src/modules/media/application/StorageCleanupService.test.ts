import { describe, expect, it, vi } from "vitest";
import { StorageCleanupService } from "./StorageCleanupService.ts";
import type { MediaStorage } from "./MediaPorts.ts";
import type { PrismaClient } from "../../../generated/prisma/client.ts";

describe("StorageCleanupService", () => {
  it("deletes stale processed media assets and calculates freed bytes", async () => {
    const mockStorage: MediaStorage = {
      save: vi.fn(),
      read: vi.fn(),
      delete: vi.fn().mockResolvedValue(true),
    };

    const mockPrisma = {
      mediaAsset: {
        findMany: vi.fn().mockResolvedValue([
          { id: "asset-1", storageKey: "processed/shop1/job1.webp", byteSize: 200000 },
          { id: "asset-2", storageKey: "processed/shop1/job2.webp", byteSize: 300000 },
        ]),
        delete: vi.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaClient;

    const cleanupService = new StorageCleanupService(mockPrisma, mockStorage);

    const result = await cleanupService.cleanupProcessedAssets({
      shopDomain: "test.myshopify.com",
      olderThanDays: 7,
    });

    expect(result.deletedAssetsCount).toBe(2);
    expect(result.freedBytes).toBe(500000);
    expect(mockStorage.delete).toHaveBeenCalledWith("processed/shop1/job1.webp");
    expect(mockStorage.delete).toHaveBeenCalledWith("processed/shop1/job2.webp");
    expect(mockPrisma.mediaAsset.delete).toHaveBeenCalledWith({ where: { id: "asset-1" } });
    expect(mockPrisma.mediaAsset.delete).toHaveBeenCalledWith({ where: { id: "asset-2" } });
  });

  it("also cleans orphaned results that no watermark job points to", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const mockPrisma = { mediaAsset: { findMany, delete: vi.fn() } } as unknown as PrismaClient;
    const mockStorage: MediaStorage = { save: vi.fn(), read: vi.fn(), delete: vi.fn() };

    await new StorageCleanupService(mockPrisma, mockStorage).cleanupProcessedAssets();

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        kind: "PROCESSED",
        OR: [
          { resultForJobs: { some: { publishedMedia: { isNot: null } } } },
          { resultForJobs: { none: {} } },
        ],
      }),
    }));
  });

  it("removes the row even when the file is already missing", async () => {
    const mockStorage: MediaStorage = {
      save: vi.fn(),
      read: vi.fn(),
      delete: vi.fn().mockResolvedValue(false),
    };
    const mockPrisma = {
      mediaAsset: {
        findMany: vi.fn().mockResolvedValue([
          { id: "asset-1", storageKey: "processed/shop1/job1.webp", byteSize: 200000 },
        ]),
        delete: vi.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaClient;

    const result = await new StorageCleanupService(mockPrisma, mockStorage).cleanupProcessedAssets();

    expect(result).toEqual({ deletedAssetsCount: 1, freedBytes: 0 });
    expect(mockPrisma.mediaAsset.delete).toHaveBeenCalledWith({ where: { id: "asset-1" } });
  });
});
