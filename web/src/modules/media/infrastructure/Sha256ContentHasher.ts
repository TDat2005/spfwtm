import { createHash } from "node:crypto";
import type { ContentHasher } from "../application/MediaPorts.ts";

export class Sha256ContentHasher implements ContentHasher {
  hash(bytes: Buffer): string {
    return createHash("sha256").update(bytes).digest("hex");
  }
}
