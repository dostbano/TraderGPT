import "./loadEnv.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

function env(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(env("FIVETICK_CLOUD_DATA", path.join(here, "..", "data")));

export const cloudConfig = {
  host: env("FIVETICK_CLOUD_HOST", "0.0.0.0"),
  port: Number(env("FIVETICK_CLOUD_PORT", "3850")),
  publicBaseUrl: env("FIVETICK_PUBLIC_BASE_URL", "https://ai.11tick.com").replace(/\/$/, ""),
  agentUrl: env("FIVETICK_AGENT_URL", "http://127.0.0.1:3847").replace(/\/$/, ""),
  dataDir,
  dbPath: path.join(dataDir, "cloud.sqlite.json"),
  /** Master switch — keep false until OAuth client IDs are configured */
  authEnabled: env("FIVETICK_AUTH_ENABLED", "0") === "1",
  githubClientId: env("FIVETICK_GITHUB_CLIENT_ID", ""),
  githubClientSecret: env("FIVETICK_GITHUB_CLIENT_SECRET", ""),
  googleClientId: env("FIVETICK_GOOGLE_CLIENT_ID", ""),
  googleClientSecret: env("FIVETICK_GOOGLE_CLIENT_SECRET", ""),
  sessionSecret: env("FIVETICK_SESSION_SECRET", "5tick-dev-change-me"),
  billingEnabled: env("FIVETICK_BILLING_ENABLED", "1") === "1",
  freeDailyRuns: Number(env("FIVETICK_FREE_DAILY_RUNS", "50")),
  stripeSecretKey: env("FIVETICK_STRIPE_SECRET_KEY", ""),
  stripeWebhookSecret: env("FIVETICK_STRIPE_WEBHOOK_SECRET", ""),
  adminToken: env("FIVETICK_ADMIN_TOKEN", "5tick-admin-dev"),
};

export function oauthReady(): { github: boolean; google: boolean } {
  return {
    github: Boolean(cloudConfig.githubClientId && cloudConfig.githubClientSecret),
    google: Boolean(cloudConfig.googleClientId && cloudConfig.googleClientSecret),
  };
}
