import fs from "node:fs";
import path from "node:path";
import { cloudConfig } from "./config.js";

export interface ProviderPublic {
  id: string;
  label: string;
  configured: boolean;
  model: string;
  active: boolean;
}

interface ProviderSecret {
  id: string;
  label: string;
  apiBase: string;
  apiKey: string;
  model: string;
}

function env(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

function builtInProviders(): ProviderSecret[] {
  return [
    {
      id: "ollama",
      label: "Ollama (local)",
      apiBase: env("FIVETICK_OLLAMA_API_BASE", env("FIVETICK_API_BASE", "http://127.0.0.1:11434/v1")),
      apiKey: env("FIVETICK_OLLAMA_API_KEY", env("FIVETICK_API_KEY", "ollama")),
      model: env("FIVETICK_OLLAMA_MODEL", env("FIVETICK_MODEL", "dolphin-llama3:8b")),
    },
    {
      id: "openai",
      label: "OpenAI",
      apiBase: env("FIVETICK_OPENAI_API_BASE", "https://api.openai.com/v1"),
      apiKey: env("FIVETICK_OPENAI_API_KEY", ""),
      model: env("FIVETICK_OPENAI_MODEL", "gpt-4o-mini"),
    },
    {
      id: "openrouter",
      label: "OpenRouter",
      apiBase: env("FIVETICK_OPENROUTER_API_BASE", "https://openrouter.ai/api/v1"),
      apiKey: env("FIVETICK_OPENROUTER_API_KEY", ""),
      model: env("FIVETICK_OPENROUTER_MODEL", "openai/gpt-4o-mini"),
    },
  ];
}

const statePath = path.join(cloudConfig.dataDir, "active-provider.json");

function readActiveId(): string {
  try {
    if (fs.existsSync(statePath)) {
      const j = JSON.parse(fs.readFileSync(statePath, "utf8")) as { id?: string };
      if (j.id) return j.id;
    }
  } catch {
    /* ignore */
  }
  return env("FIVETICK_DEFAULT_PROVIDER", "ollama");
}

function writeActiveId(id: string): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({ id, updatedAt: new Date().toISOString() }, null, 2));
}

export function listProviders(): ProviderPublic[] {
  const active = readActiveId();
  return builtInProviders().map((p) => ({
    id: p.id,
    label: p.label,
    configured: p.id === "ollama" ? true : Boolean(p.apiKey),
    model: p.model,
    active: p.id === active,
  }));
}

export function getActiveProvider(): ProviderSecret {
  const active = readActiveId();
  const all = builtInProviders();
  return all.find((p) => p.id === active) || all[0]!;
}

export function setActiveProvider(id: string): ProviderPublic {
  const all = builtInProviders();
  const found = all.find((p) => p.id === id);
  if (!found) throw new Error(`Unknown provider: ${id}`);
  if (found.id !== "ollama" && !found.apiKey) {
    throw new Error(
      `${found.label} is not configured. Set the API key in .env (FIVETICK_OPENAI_API_KEY or FIVETICK_OPENROUTER_API_KEY).`,
    );
  }
  writeActiveId(id);
  return listProviders().find((p) => p.id === id)!;
}

export function resolveModelProvider(providerId?: string): {
  apiBase: string;
  apiKey: string;
  model: string;
  providerId: string;
} {
  const all = builtInProviders();
  const id = providerId || readActiveId();
  const p = all.find((x) => x.id === id) || getActiveProvider();
  if (p.id !== "ollama" && !p.apiKey) {
    throw new Error(`${p.label} needs an API key in .env`);
  }
  return {
    apiBase: p.apiBase,
    apiKey: p.apiKey,
    model: p.model,
    providerId: p.id,
  };
}
