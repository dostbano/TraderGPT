import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Load monorepo root .env into process.env (does not override existing). */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const envPath = path.join(root, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!(k in process.env)) process.env[k] = v;
  }
}
