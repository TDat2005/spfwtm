import { All, Controller, Res } from "@nestjs/common";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Response } from "express";

@Controller()
export class SpaController {
  @All("{*path}")
  serve(@Res() response: Response): void {
    const staticPath = process.env.NODE_ENV === "production"
      ? join(process.cwd(), "frontend", "dist")
      : join(process.cwd(), "frontend");
    response
      .status(200)
      .set("Content-Type", "text/html")
      .send(
        readFileSync(join(staticPath, "index.html"))
          .toString()
          .replace("%VITE_SHOPIFY_API_KEY%", process.env.SHOPIFY_API_KEY || ""),
      );
  }
}
