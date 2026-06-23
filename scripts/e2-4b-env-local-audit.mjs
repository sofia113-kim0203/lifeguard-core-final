/**
 * E-2-4B preflight — audit .env.local refs without printing secret values.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = path.join(ROOT, ".env.local");
const PROD = "fhvlxcguvjvtftttfrix";
const STAGING = "inwswsruvvzaeioqkelq";

function auditEnvLocal() {
  if (!fs.existsSync(ENV_PATH)) {
    return { missing: true, entries: [] };
  }
  const entries = [];
  for (const line of fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
    const urlHost = (value.match(/https?:\/\/([^./]+)/) || [])[1] || null;
    entries.push({
      key,
      is_set: value.length > 0,
      has_production_ref: value.includes(PROD),
      has_staging_ref: value.includes(STAGING),
      url_host: urlHost,
    });
  }
  return { missing: false, entries };
}

const result = auditEnvLocal();
console.log(JSON.stringify({ production_ref: PROD, staging_ref: STAGING, ...result }, null, 2));
