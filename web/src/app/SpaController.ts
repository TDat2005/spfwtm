import { All, Controller, Header, Req } from "@nestjs/common";
import type { Request } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isStandalonePageRequest } from "../shared/platform.ts";

const APP_BRIDGE_META = /<meta name="shopify-api-key"[^>]*>\s*/;
const APP_BRIDGE_SCRIPT = /<script[^>]*src="https:\/\/cdn\.shopify\.com\/shopifycloud\/app-bridge\.js"[^>]*><\/script>\s*/;

@Controller()
export class SpaController {
  @All("{*path}")
  @Header("Content-Type", "text/html")
  serve(@Req() request: Request): string {
    const staticPath = process.env.NODE_ENV === "production"
      ? join(process.cwd(), "frontend", "dist")
      : join(process.cwd(), "frontend");
    const html = readFileSync(join(staticPath, "index.html")).toString();
    if (isStandalonePageRequest(request)) {
      // Ngoài Shopify Admin thì không tải App Bridge (nó sẽ cố chuyển hướng về Admin).
      return html
        .replace(APP_BRIDGE_META, "")
        .replace(APP_BRIDGE_SCRIPT, "")
        .replace("</head>", '  <meta name="app-platform" content="standalone" />\n  </head>');
    }
    return html.replace("%VITE_SHOPIFY_API_KEY%", process.env.SHOPIFY_API_KEY || "");
  }
}
