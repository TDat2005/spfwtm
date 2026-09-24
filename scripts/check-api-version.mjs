import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = new URL("../", import.meta.url);
const expectedVersion = "2026-07";
const errors = [];

const toml = await readFile(new URL("shopify.app.toml", root), "utf8");
const backend = await readFile(new URL("web/shopify.js", root), "utf8");

const tomlVersion = toml.match(/api_version\s*=\s*"([^"]+)"/)?.[1];
const backendVersion = backend.match(
  /SHOPIFY_API_VERSION\s*=\s*"([^"]+)"/
)?.[1];

if (tomlVersion !== expectedVersion) {
  errors.push(`shopify.app.toml phải dùng ${expectedVersion}, đang là ${tomlVersion}`);
}
if (backendVersion !== expectedVersion) {
  errors.push(`Backend phải dùng ${expectedVersion}, đang là ${backendVersion}`);
}
if (tomlVersion !== backendVersion) {
  errors.push("Webhook API version và backend GraphQL version không khớp");
}

for (const topic of [
  "products/update",
  "products/delete",
  "app/uninstalled",
  "bulk_operations/finish",
  "customers/data_request",
  "customers/redact",
  "shop/redact",
]) {
  if (!toml.includes(`"${topic}"`)) {
    errors.push(`Thiếu webhook subscription ${topic}`);
  }
}

const sourceFiles = await collectFiles(new URL("web/", root));
for (const file of sourceFiles) {
  const text = await readFile(file, "utf8");
  if (text.includes("LATEST_API_VERSION")) {
    errors.push(`${file.pathname}: cấm LATEST_API_VERSION`);
  }
  if (/shopify-api\/rest\/admin\//.test(text)) {
    errors.push(`${file.pathname}: không được import REST resources`);
  }
  for (const match of text.matchAll(/["'](20\d{2}-(?:01|04|07|10))["']/g)) {
    if (match[1] !== expectedVersion) {
      errors.push(`${file.pathname}: Shopify API version ${match[1]} không được hỗ trợ`);
    }
  }
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Shopify GraphQL và webhook cùng dùng API ${expectedVersion}.`);
}

async function collectFiles(directoryUrl) {
  const directory = fileURLToPath(directoryUrl);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (
      entry.name === "node_modules" ||
      entry.name === "generated" ||
      entry.name === "dist"
    ) {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(pathToFileURL(`${path}/`))));
    } else if ([".js", ".ts", ".toml"].includes(extname(entry.name))) {
      files.push(pathToFileURL(path));
    }
  }
  return files;
}
