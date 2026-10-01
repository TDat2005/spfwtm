import { All, Controller, Header } from "@nestjs/common";
import { readFileSync } from "node:fs";
import { join } from "node:path";

@Controller()
export class SpaController {
  @All("{*path}")
  @Header("Content-Type", "text/html")
  serve(): string {
    const staticPath = process.env.NODE_ENV === "production"
      ? join(process.cwd(), "frontend", "dist")
      : join(process.cwd(), "frontend");
    return readFileSync(join(staticPath, "index.html"))
      .toString()
      .replace("%VITE_SHOPIFY_API_KEY%", process.env.SHOPIFY_API_KEY || "");
  }
}
