import "./loadEnv.js";
import cors from "cors";
import express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AgentRequest, HealthResponse } from "@5tick/shared";
import { runAgent } from "./agent.js";
import { resolveConfirm } from "./confirmGate.js";
import { assertConfig, config } from "./config.js";
import { runDemo } from "./demo.js";
import { log } from "./logger.js";
import { warmModel } from "./model.js";

assertConfig();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "4mb" }));

app.get("/health", (_req, res) => {
  const body: HealthResponse = {
    ok: true,
    product: "5Tick",
    model: config.model,
    apiBase: config.apiBase,
    workspace: config.workspace,
  };
  res.json(body);
});

const contextSchema = z
  .object({
    openFiles: z.array(z.string()).optional(),
    activeFile: z.string().optional(),
    selection: z.string().optional(),
    gitStatus: z.string().optional(),
    projectTree: z.string().optional(),
  })
  .optional();

const agentSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant", "tool"]),
        content: z.string(),
        name: z.string().optional(),
        tool_call_id: z.string().optional(),
      }),
    )
    .min(1),
  workspaceRoot: z.string().optional(),
  maxSteps: z.number().int().positive().max(40).optional(),
  mode: z.enum(["ask", "ide", "solo"]).optional(),
  context: contextSchema,
  requestId: z.string().optional(),
  safeMode: z.boolean().optional(),
  modelProvider: z
    .object({
      apiBase: z.string().optional(),
      apiKey: z.string().optional(),
      model: z.string().optional(),
      providerId: z.string().optional(),
    })
    .optional(),
});

function streamNdjson(
  req: express.Request,
  res: express.Response,
  sourceFactory: (signal: AbortSignal) => AsyncGenerator<{ type: string; data: unknown }>,
): void {
  const ac = new AbortController();
  // Only abort when the *response* is closed early (client Stop / disconnect).
  // Do not use req "close" — it fires when the request body finishes and would
  // cancel the agent before any events are written.
  const onResClose = () => {
    if (!res.writableEnded) ac.abort();
  };
  res.on("close", onResClose);

  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  void (async () => {
    try {
      for await (const event of sourceFactory(ac.signal)) {
        if (ac.signal.aborted || res.writableEnded) break;
        res.write(`${JSON.stringify(event)}\n`);
      }
    } catch (err) {
      if (!res.writableEnded) {
        res.write(
          `${JSON.stringify({
            type: "error",
            data: { message: err instanceof Error ? err.message : String(err) },
          })}\n`,
        );
      }
    } finally {
      res.off("close", onResClose);
      if (!res.writableEnded) res.end();
    }
  })();
}

app.post("/v1/agent", async (req, res) => {
  const parsed = agentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const body = parsed.data as AgentRequest;
  body.requestId = body.requestId || randomUUID();
  log("info", "http.agent", {
    requestId: body.requestId,
    mode: body.mode || "ide",
    messages: body.messages.length,
  });
  streamNdjson(req, res, (signal) => runAgent(body, { signal }));
});

app.post("/v1/confirm", (req, res) => {
  const schema = z.object({
    requestId: z.string().min(1),
    toolCallId: z.string().min(1),
    approved: z.boolean(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const ok = resolveConfirm(
    parsed.data.requestId,
    parsed.data.toolCallId,
    parsed.data.approved,
  );
  log("info", "http.confirm", { ...parsed.data, ok });
  res.json({ ok });
});

/** No-LLM Phase 3 smoke stream (write + terminal + previousContent). */
app.post("/v1/demo", async (req, res) => {
  const workspaceRoot =
    typeof req.body?.workspaceRoot === "string" && req.body.workspaceRoot
      ? req.body.workspaceRoot
      : config.workspace;
  streamNdjson(req, res, async function* () {
    yield* runDemo(workspaceRoot);
  });
});

app.listen(config.port, config.host, () => {
  log("info", "server.listen", {
    url: `http://${config.host}:${config.port}`,
    model: config.model,
    apiBase: config.apiBase,
    workspace: config.workspace,
    safeMode: config.safeMode,
    hasApiKey: Boolean(config.apiKey),
  });
  if (!config.apiKey) {
    log("warn", "FIVETICK_API_KEY is empty");
  }
  void warmModel().then(() => log("info", "model.warm.done", { model: config.model }));
});
