import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import { WatermarkDesign } from "../domain/WatermarkDesign.ts";

type DesignClient = Pick<PrismaClient, "watermarkDesign">;

/**
 * Lưu design (bất biến) và trả về ID. Design trùng nội dung trong cùng shop
 * dùng lại bản đã có, nên batch 10.000 job chỉ tạo một dòng design.
 */
export async function saveWatermarkDesign(
  client: DesignClient,
  shopId: string,
  design: WatermarkDesign
): Promise<string> {
  const layers = JSON.stringify(design.toJSON());
  const contentHash = createHash("sha256").update(layers).digest("hex");
  const where = { shopId_contentHash: { shopId, contentHash } };

  const existing = await client.watermarkDesign.findUnique({ where, select: { id: true } });
  if (existing) return existing.id;

  try {
    const created = await client.watermarkDesign.create({
      data: { id: randomUUID(), shopId, contentHash, layers },
      select: { id: true },
    });
    return created.id;
  } catch (error) {
    // Hai request cùng lúc tạo cùng một design: bên thua đọc lại bản đã có.
    if (!isUniqueConstraintError(error)) throw error;
    const winner = await client.watermarkDesign.findUnique({ where, select: { id: true } });
    if (!winner) throw error;
    return winner.id;
  }
}

export function readWatermarkDesign(row: { layers: string }): WatermarkDesign {
  return WatermarkDesign.fromJSON(row.layers);
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
