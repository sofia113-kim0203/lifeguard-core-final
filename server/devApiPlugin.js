/**
 * Vite dev middleware — serves /api/* handlers locally (mirrors Vercel serverless routes).
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function loadEnvLocal(rootDir) {
  const envPath = path.join(rootDir, ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

function resolveApiHandlerPath(rootDir, pathname) {
  const normalized = pathname.replace(/^\/api\//, "").replace(/\/$/, "");
  if (!normalized || normalized.includes("..")) return null;
  const filePath = path.join(rootDir, "api", `${normalized}.js`);
  if (!fs.existsSync(filePath)) return null;
  return filePath;
}

export function lifeguardDevApiPlugin({ rootDir = process.cwd() } = {}) {
  loadEnvLocal(rootDir);

  return {
    name: "lifeguard-dev-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const url = new URL(req.url ?? "/", "http://localhost");
          if (!url.pathname.startsWith("/api/")) {
            next();
            return;
          }

          const handlerPath = resolveApiHandlerPath(rootDir, url.pathname);
          if (!handlerPath) {
            res.statusCode = 404;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, reason: "API_ROUTE_NOT_FOUND", path: url.pathname }));
            return;
          }

          const module = await import(pathToFileURL(handlerPath).href);
          if (typeof module.default !== "function") {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, reason: "API_HANDLER_INVALID" }));
            return;
          }

          await module.default(req, res);
        } catch (error) {
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                ok: false,
                reason: "DEV_API_MIDDLEWARE_ERROR",
                error_message: error instanceof Error ? error.message : "Dev API failed.",
              }),
            );
          }
        }
      });
    },
  };
}
