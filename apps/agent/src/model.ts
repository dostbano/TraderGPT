import {
  TOOL_DEFINITIONS,
  type ChatMessage,
  type ModelProviderOverride,
  type ToolDefinition,
  type ToolCall,
} from "@5tick/shared";
import { config } from "./config.js";

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ApiMessage = ChatMessage & {
  tool_calls?: OpenAIToolCall[];
};

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason?: string;
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  error?: { message?: string };
}

export interface ModelTurn {
  content: string;
  toolCalls: ToolCall[];
  finishReason?: string;
}

export interface ChatCompletionOptions {
  toolsEnabled?: boolean;
  /** Subset of tools to expose (defaults to all TOOL_DEFINITIONS when toolsEnabled). */
  tools?: ToolDefinition[];
  /** Per-request provider override (OpenAI / Ollama / OpenRouter). */
  modelProvider?: ModelProviderOverride;
  /** Called with cumulative assistant text as tokens arrive (Ask / no-tools path). */
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw || "{}") as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return { _raw: raw };
  }
}

function buildMessages(messages: ApiMessage[]) {
  return messages.map((m) => {
    if (m.role === "tool") {
      return {
        role: "tool",
        content: m.content,
        tool_call_id: m.tool_call_id,
        name: m.name,
      };
    }
    if (m.tool_calls?.length) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.tool_calls,
      };
    }
    return { role: m.role, content: m.content };
  });
}

function ollamaOptions(toolsEnabled: boolean): Record<string, unknown> {
  // CPU-bound box: smaller context + capped tokens = much faster replies
  return {
    num_ctx: Number(process.env.FIVETICK_NUM_CTX || "2048"),
    num_predict: Number(
      process.env.FIVETICK_NUM_PREDICT || (toolsEnabled ? "768" : "384"),
    ),
    temperature: 0.7,
  };
}

export async function chatCompletion(
  messages: ApiMessage[],
  opts: ChatCompletionOptions = {},
): Promise<ModelTurn> {
  const toolDefs =
    opts.tools ??
    (opts.toolsEnabled === false ? [] : TOOL_DEFINITIONS);
  const toolsEnabled = toolDefs.length > 0;
  const apiBase = (opts.modelProvider?.apiBase || config.apiBase).replace(/\/$/, "");
  const apiKey = opts.modelProvider?.apiKey ?? config.apiKey;
  const model = opts.modelProvider?.model || config.model;
  const localBase =
    apiBase.includes("localhost") || apiBase.includes("127.0.0.1");
  if (!apiKey && !localBase) {
    throw new Error(
      "Missing API key for this provider. Set FIVETICK_API_KEY or provider-specific keys in .env.",
    );
  }

  const useStream = !toolsEnabled;
  const body: Record<string, unknown> = {
    model,
    messages: buildMessages(messages),
    stream: useStream,
  };
  // Ollama-only knobs
  if (localBase || apiBase.includes("11434")) {
    body.keep_alive = process.env.FIVETICK_KEEP_ALIVE || "24h";
    body.options = ollamaOptions(toolsEnabled);
  }
  if (toolsEnabled) {
    body.tools = toolDefs.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
    body.tool_choice = "auto";
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  let res: Response;
  try {
    res = await fetch(`${apiBase}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Model API unreachable at ${apiBase} (${detail}). Provider model "${model}".`,
    );
  }

  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as ChatCompletionResponse;
    throw new Error(json.error?.message || `Model API error HTTP ${res.status}`);
  }

  if (!useStream) {
    const json = (await res.json()) as ChatCompletionResponse;
    const message = json.choices?.[0]?.message;
    if (!message) throw new Error("Model returned no choices");
    const toolCalls: ToolCall[] = (message.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: parseArgs(tc.function.arguments),
    }));
    const content = message.content ?? "";
    if (content) opts.onDelta?.(content);
    return {
      content,
      toolCalls,
      finishReason: json.choices?.[0]?.finish_reason,
    };
  }

  // NDJSON / SSE stream from Ollama OpenAI-compat
  if (!res.body) throw new Error("Model returned empty stream body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let finishReason: string | undefined;

  while (true) {
    if (opts.signal?.aborted) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      throw new DOMException("Aborted", "AbortError");
    }
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line === "data: [DONE]") continue;
      const payload = line.startsWith("data:") ? line.slice(5).trim() : line;
      if (!payload || payload === "[DONE]") continue;
      let chunk: ChatCompletionResponse;
      try {
        chunk = JSON.parse(payload) as ChatCompletionResponse;
      } catch {
        continue;
      }
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        content += delta;
        opts.onDelta?.(content);
      }
      const fr = chunk.choices?.[0]?.finish_reason;
      if (fr) finishReason = fr;
    }
  }

  return { content, toolCalls: [], finishReason };
}

/** Preload model into RAM so the first user message is not a cold start. */
export async function warmModel(): Promise<void> {
  const localBase =
    config.apiBase.includes("localhost") || config.apiBase.includes("127.0.0.1");
  if (!localBase) return;
  try {
    await fetch(`${config.apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: "ok" }],
        stream: false,
        keep_alive: process.env.FIVETICK_KEEP_ALIVE || "24h",
        options: { num_predict: 1, num_ctx: 512 },
      }),
    });
  } catch {
    /* warm is best-effort */
  }
}
