import path from "node:path";
import { fileURLToPath } from "node:url";

function env(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

const monorepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export const config = {
  product: "5Tick" as const,
  host: env("FIVETICK_HOST", "127.0.0.1"),
  port: Number(env("FIVETICK_PORT", "3847")),
  apiBase: env("FIVETICK_API_BASE", "https://api.openai.com/v1").replace(/\/$/, ""),
  apiKey: env("FIVETICK_API_KEY", ""),
  model: env("FIVETICK_MODEL", "gpt-4o-mini"),
  workspace: path.resolve(env("FIVETICK_WORKSPACE") || monorepoRoot),
  safeMode: env("FIVETICK_SAFE_MODE", "1") !== "0",
  maxSteps: Number(env("FIVETICK_MAX_STEPS", "12")),
};

export function assertConfig(): void {
  if (!Number.isFinite(config.port) || config.port <= 0) {
    throw new Error("FIVETICK_PORT must be a positive number");
  }
}
