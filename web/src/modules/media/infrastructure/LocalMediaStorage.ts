import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { MediaStorage } from "../application/MediaPorts.ts";

export class LocalMediaStorage implements MediaStorage {
  private readonly root: string;

  constructor(rootDirectory: string) {
    this.root = resolve(rootDirectory);
  }

  async save(storageKey: string, bytes: Buffer): Promise<void> {
    const path = this.resolveKey(storageKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  async read(storageKey: string): Promise<Buffer> {
    return readFile(this.resolveKey(storageKey));
  }

  private resolveKey(storageKey: string): string {
    const path = resolve(this.root, storageKey);
    if (path !== this.root && !path.startsWith(`${this.root}${sep}`)) {
      throw new Error("Storage key không hợp lệ");
    }
    return path;
  }
}
