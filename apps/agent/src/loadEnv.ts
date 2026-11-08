import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const candidates = [
  process.env.DOTENV_CONFIG_PATH,
  path.resolve(here, "../.env"), // bundled agent folder
  path.resolve(here, "../../.env"), // apps/agent/.env (unusual)
  path.resolve(here, "../../../.env"), // monorepo 5Tick/.env
].filter(Boolean) as string[];

function applyEnvFile(envPath: string): void {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Do not override vars already set by the IDE host
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

for (const p of candidates) applyEnvFile(p);
