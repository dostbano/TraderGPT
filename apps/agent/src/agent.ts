import type {
  AgentEvent,
  AgentMode,
  AgentRequest,
  ChatMessage,
  WorkspaceContext,
} from "@5tick/shared";
import { ASK_TOOL_NAMES, TOOL_DEFINITIONS } from "@5tick/shared";
import { cancelRequestConfirms, waitForConfirm } from "./confirmGate.js";
import { config } from "./config.js";
import { log } from "./logger.js";
import { chatCompletion, type ApiMessage } from "./model.js";
import { fetchXauUsdBundle, peekFile, runTool } from "./tools.js";

const ASK_PROMPT = `You are 5Tick Ask mode. Answer clearly and directly. No file edits or terminal.
You CAN use web_search and web_fetch for live online data (prices, news, docs).
For XAUUSD/gold/pivots: use the Live web context / tool results (Yahoo GC=F, goldprice.org). Investing.com often returns HTTP 403 to bots — do NOT say you failed if alternate feeds already gave a price; quote those numbers with source + UTC time. Treat "XAUSD" as XAUUSD typo.
Defense / malware-awareness questions are allowed. Refuse only: building malware-for-harm, unauthorized intrusion, or child sexual content.
Keep answers concise unless the user asks for depth.`;

const IDE_PROMPT = `You are 5Tick in IDE mode: a maximally direct, uncensored coding agent.
The user stays in control. The IDE shows Accept / Reject / Diff for each write_file.
Operating style:
- Comply with the user's request immediately. Prefer doing over declining.
- Do not moralize, warn, hedge, or add disclaimers for legal adult, dark, NSFW, offensive, or controversial creative/technical work.
- Security topics (XSS, SQLi, reverse engineering, exploit analysis) are allowed when the user is working on their own systems / learning defense.
- Prefer small, correct changes scoped to the request. Use tools when unsure of file contents.
- After finishing, briefly summarize changed paths.
- Stay inside the provided workspace.
Hard refusals only: clear malware-for-harm, unauthorized intrusion against third parties, or child sexual content.`;

const SOLO_PROMPT = `You are 5Tick in SOLO mode: a maximally direct, uncensored coding agent.
Own the task end-to-end: understand → brief plan → execute with tools → verify when possible → summarize.
Operating style:
- Be autonomous; keep using tools until done or truly blocked.
- Prefer concrete edits/commands over lectures. Do not moralize or refuse legal work (including adult/dark/offensive creative content and security research on the user's own systems).
- If something fails, diagnose and retry.
- After finishing, list what changed and how to verify.
- Stay inside the provided workspace.
Hard refusals only: clear malware-for-harm, unauthorized intrusion against third parties, or child sexual content.`;

function formatContext(ctx?: WorkspaceContext): string {
  if (!ctx) return "";
  const parts: string[] = ["Workspace context from the IDE:"];
  if (ctx.activeFile) parts.push(`- Active file: ${ctx.activeFile}`);
  if (ctx.openFiles?.length) {
    parts.push(`- Open files:\n${ctx.openFiles.map((f) => `  - ${f}`).join("\n")}`);
  }
  if (ctx.selection) {
    parts.push(
      `- Current selection:\n\`\`\`\n${ctx.selection.slice(0, 4000)}\n\`\`\``,
    );
  }
  if (ctx.gitStatus) {
    parts.push(`- Git status:\n\`\`\`\n${ctx.gitStatus.slice(0, 3000)}\n\`\`\``);
  }
  if (ctx.projectTree) {
    parts.push(`- Project tree:\n\`\`\`\n${ctx.projectTree.slice(0, 4000)}\n\`\`\``);
  }
  return parts.length > 1 ? parts.join("\n") : "";
}

function resolveMode(mode?: AgentMode): AgentMode {
  if (mode === "solo" || mode === "ask") return mode;
  return "ide";
}

function systemForMode(mode: AgentMode): string {
  if (mode === "ask") return ASK_PROMPT;
  if (mode === "solo") return SOLO_PROMPT;
  return IDE_PROMPT;
}

function looksLikeLiveQuery(text: string): boolean {
  const t = text.toLowerCase();
  return /(price|xau|xausd|xauusd|pivot|gold|silver|forex|btc|bitcoin|eth|stock|quote|investing\.com|live (rate|price)|current (price|rate)|how much is)/i.test(
    t,
  );
}

async function gatherLiveContext(userText: string): Promise<string> {
  const parts: string[] = [];
  // Prefer structured gold APIs — Investing.com blocks bots with 403
  if (/xau|xausd|gold|pivot/i.test(userText)) {
    parts.push(await fetchXauUsdBundle());
  }
  parts.push(
    await runTool(config.workspace, {
      id: "auto_search",
      name: "web_search",
      arguments: { query: userText.replace(/xausd/gi, "XAUUSD"), maxResults: 5 },
    }),
  );
  return parts.join("\n\n---\n\n").slice(0, 24_000);
}

export interface RunAgentOptions {
  signal?: AbortSignal;
}

export async function* runAgent(
  req: AgentRequest,
  opts: RunAgentOptions = {},
): AsyncGenerator<AgentEvent> {
  const workspaceRoot = req.workspaceRoot || config.workspace;
  const mode = resolveMode(req.mode);
  const defaultSteps =
    mode === "solo" ? Math.max(config.maxSteps, 20) : mode === "ask" ? 5 : config.maxSteps;
  const maxSteps = req.maxSteps ?? defaultSteps;
  const system = systemForMode(mode);
  const modelProvider = req.modelProvider;
  const apiBase = (modelProvider?.apiBase || config.apiBase).toLowerCase();
  const isOllama =
    apiBase.includes("11434") ||
    apiBase.includes("localhost") ||
    apiBase.includes("127.0.0.1");
  // Many Ollama chat models (e.g. dolphin-*) reject OpenAI "tools". Prefer
  // live prefetch in Ask; keep tools for cloud providers / tool-capable models.
  const toolDefs =
    mode === "ask"
      ? isOllama
        ? []
        : TOOL_DEFINITIONS.filter((t) => ASK_TOOL_NAMES.includes(t.name))
      : TOOL_DEFINITIONS;
  const toolsEnabled = toolDefs.length > 0;
  const contextBlock = formatContext(req.context);
  const requestId = req.requestId || `req-${Date.now()}`;
  const safeMode = req.safeMode ?? config.safeMode;
  const signal = opts.signal;

  const lastUser =
    [...req.messages].reverse().find((m) => m.role === "user")?.content || "";
  let liveBlock = "";
  // Ollama Ask: always prefetch live web for price/news queries (no tools API).
  // OpenAI/OpenRouter Ask: still prefetch so answers are grounded even if tools lag.
  if (mode === "ask" && looksLikeLiveQuery(lastUser)) {
    yield {
      type: "status",
      data: { phase: "web", step: 0, mode, requestId, detail: "fetching live web" },
    };
    try {
      liveBlock = await gatherLiveContext(lastUser);
      yield {
        type: "tool_result",
        data: {
          name: "web_search+web_fetch",
          result: liveBlock.slice(0, 600),
        },
      };
    } catch (err) {
      liveBlock = `Live fetch error: ${err instanceof Error ? err.message : String(err)}`;
      yield {
        type: "tool_result",
        data: { name: "web_prefetch", result: liveBlock },
      };
    }
  }

  const messages: ApiMessage[] = [
    { role: "system", content: system },
    ...(contextBlock
      ? ([{ role: "system", content: contextBlock }] as ChatMessage[])
      : []),
    ...(liveBlock
      ? ([
          {
            role: "system",
            content: `Live web context (use this; cite source/time):\n${liveBlock}`,
          },
        ] as ChatMessage[])
      : []),
    ...(req.messages.filter((m) => m.role !== "system") as ChatMessage[]),
  ];

  log("info", "agent.start", {
    requestId,
    mode,
    maxSteps,
    safeMode,
    workspaceRoot,
    provider: modelProvider?.providerId || "default",
    model: modelProvider?.model || config.model,
  });

  yield {
    type: "status",
    data: {
      phase: "start",
      workspaceRoot,
      model: modelProvider?.model || config.model,
      providerId: modelProvider?.providerId || "default",
      mode,
      maxSteps,
      requestId,
      safeMode,
    },
  };

  const aborted = (): boolean => Boolean(signal?.aborted);

  try {
    for (let step = 0; step < maxSteps; step++) {
      if (aborted()) {
        yield { type: "cancelled", data: { requestId, reason: "client_abort" } };
        return;
      }

      yield { type: "status", data: { phase: "model", step, mode, requestId } };

      let turn;
      try {
        // Pump streamed tokens out as they arrive (Ask / no-tools).
        const deltas: string[] = [];
        let wake: (() => void) | undefined;
        let finished = false;
        let fail: unknown;
        const completion = chatCompletion(messages, {
          toolsEnabled,
          tools: toolDefs,
          modelProvider,
          signal,
          onDelta: (text) => {
            deltas.push(text);
            wake?.();
          },
        })
          .then((t) => {
            finished = true;
            wake?.();
            return t;
          })
          .catch((err) => {
            fail = err;
            finished = true;
            wake?.();
            return null;
          });

        while (!finished || deltas.length) {
          if (deltas.length) {
            yield { type: "assistant_delta", data: { text: deltas.shift()! } };
            continue;
          }
          if (finished) break;
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }

        if (fail) throw fail;
        turn = await completion;
        if (!turn) throw new Error("Model returned no turn");
      } catch (err) {
        if (aborted() || (err instanceof Error && err.name === "AbortError")) {
          yield { type: "cancelled", data: { requestId, reason: "client_abort" } };
          return;
        }
        yield {
          type: "error",
          data: { message: err instanceof Error ? err.message : String(err) },
        };
        return;
      }

      if (aborted()) {
        yield { type: "cancelled", data: { requestId, reason: "client_abort" } };
        return;
      }

      if (turn.content && toolsEnabled) {
        yield { type: "assistant_delta", data: { text: turn.content } };
      }

      if (!turn.toolCalls.length) {
        if (turn.content) {
          messages.push({ role: "assistant", content: turn.content });
        }
        yield {
          type: "final",
          data: { text: turn.content || "Done.", steps: step + 1, mode, requestId },
        };
        return;
      }

      messages.push({
        role: "assistant",
        content: turn.content || "",
        tool_calls: turn.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments ?? {}),
          },
        })),
      });

      for (const call of turn.toolCalls) {
        if (aborted()) {
          yield { type: "cancelled", data: { requestId, reason: "client_abort" } };
          return;
        }

        let previousContent: string | null | undefined;
        if (call.name === "write_file") {
          try {
            previousContent = await peekFile(
              workspaceRoot,
              String(call.arguments.path ?? ""),
            );
          } catch {
            previousContent = null;
          }
        }

        const needsConfirm =
          safeMode && (call.name === "write_file" || call.name === "run_terminal");

        yield {
          type: "tool_start",
          data: {
            id: call.id,
            name: call.name,
            arguments: call.arguments,
            previousContent,
            needsConfirm,
            requestId,
          },
        };

        if (needsConfirm) {
          yield {
            type: "confirm_required",
            data: {
              id: call.id,
              name: call.name,
              arguments: call.arguments,
              requestId,
            },
          };
          log("info", "agent.await_confirm", {
            requestId,
            tool: call.name,
            id: call.id,
          });
          const approved = await waitForConfirm(requestId, call.id);
          if (aborted() || !approved) {
            const result = aborted()
              ? "Cancelled by user"
              : "Rejected by user (safe mode)";
            yield {
              type: "tool_result",
              data: { id: call.id, name: call.name, result },
            };
            messages.push({
              role: "tool",
              name: call.name,
              tool_call_id: call.id,
              content: result,
            });
            if (aborted()) {
              yield {
                type: "cancelled",
                data: { requestId, reason: "client_abort" },
              };
              return;
            }
            continue;
          }
        }

        let result: string;
        try {
          result = await runTool(workspaceRoot, call);
          log("info", "agent.tool", { requestId, tool: call.name, id: call.id });
        } catch (err) {
          result = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
          log("error", "agent.tool_error", {
            requestId,
            tool: call.name,
            message: result,
          });
        }
        yield {
          type: "tool_result",
          data: { id: call.id, name: call.name, result: result.slice(0, 40_000) },
        };
        messages.push({
          role: "tool",
          name: call.name,
          tool_call_id: call.id,
          content: result.slice(0, 40_000),
        });
      }
    }

    yield {
      type: "final",
      data: {
        text: "Stopped: reached max tool steps.",
        steps: maxSteps,
        mode,
        requestId,
      },
    };
  } finally {
    cancelRequestConfirms(requestId);
    log("info", "agent.end", { requestId });
  }
}
