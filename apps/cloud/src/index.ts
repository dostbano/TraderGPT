import "./loadEnv.js";
import cors from "cors";
import express, { type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloudConfig } from "./config.js";
import { authRouter, authStatus, optionalAuth, requireAdmin, type AuthedRequest } from "./auth.js";
import { billingRouter, checkEntitlement, recordRun } from "./billing.js";
import { historyRouter } from "./history.js";
import {
  listProviders,
  resolveModelProvider,
  setActiveProvider,
} from "./providers.js";
import { store } from "./store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wwwRoot = path.join(__dirname, "..", "www");

fs.mkdirSync(cloudConfig.dataDir, { recursive: true });

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "4mb" }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "5tick-cloud",
    publicBaseUrl: cloudConfig.publicBaseUrl,
    agentUrl: cloudConfig.agentUrl,
    auth: authStatus(),
    billingEnabled: cloudConfig.billingEnabled,
  });
});

app.use("/api/auth", authRouter);
app.use("/api/billing", billingRouter);
app.use("/api/history", historyRouter);

app.get("/api/providers", (_req, res) => {
  res.json({ providers: listProviders() });
});

app.post("/api/providers/active", (req, res) => {
  try {
    const id = String(req.body?.id || "");
    const active = setActiveProvider(id);
    res.json({ ok: true, active, providers: listProviders() });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get("/api/admin/overview", requireAdmin, (_req, res) => {
  res.json({
    users: store.listUsers().length,
    usage: store.usageSummary(),
    auth: authStatus(),
    agentUrl: cloudConfig.agentUrl,
    publicBaseUrl: cloudConfig.publicBaseUrl,
  });
});

app.get("/api/admin/users", requireAdmin, (_req, res) => {
  res.json({ users: store.listUsers(), usage: store.usageSummary() });
});

/** Proxy local agent through cloud (entitlement + optional history). Path matches agent API. */
async function proxyAgent(
  req: AuthedRequest,
  res: Response,
  agentPath: string,
): Promise<void> {
  const ent = checkEntitlement(req.user);
  if (!ent.ok) {
    res.status(402).json({ error: ent.reason, entitlement: ent });
    return;
  }

  const body = { ...(req.body ?? {}) } as Record<string, unknown>;
  const userText =
    Array.isArray(body.messages) && body.messages.length
      ? String(
          (body.messages as Array<{ content?: string }>)[body.messages.length - 1]
            ?.content || "",
        )
      : "";

  try {
    // Inject provider secrets server-side (browser only sends providerId)
    const providerId =
      (typeof body.providerId === "string" && body.providerId) ||
      (body.modelProvider as { providerId?: string } | undefined)?.providerId;
    try {
      body.modelProvider = resolveModelProvider(providerId);
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : String(e),
      });
      return;
    }
    delete body.providerId;

    const upstream = await fetch(`${cloudConfig.agentUrl}${agentPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/x-ndjson",
      },
      body: JSON.stringify(body),
    });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      res.status(upstream.status).json({
        error: "agent upstream failed",
        detail: text.slice(0, 500),
      });
      return;
    }

    if (agentPath === "/v1/agent") recordRun(req.user);

    res.status(200);
    res.setHeader(
      "Content-Type",
      upstream.headers.get("content-type") || "application/x-ndjson; charset=utf-8",
    );
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let assistantBuf = "";
    let lineCarry = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      res.write(chunk);

      lineCarry += chunk;
      const lines = lineCarry.split("\n");
      lineCarry = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line) as {
            type?: string;
            data?: { text?: string; delta?: string };
          };
          if (evt.type === "assistant_delta" && evt.data?.text) {
            assistantBuf = evt.data.text;
          }
          if (evt.type === "final" && evt.data?.text) {
            assistantBuf = evt.data.text;
          }
        } catch {
          /* ignore parse */
        }
      }
    }

    if (req.user && userText && agentPath === "/v1/agent") {
      store.appendHistory(req.user.id, String(body.projectKey || "default"), userText, [
        { role: "user", content: userText, at: new Date().toISOString() },
        {
          role: "assistant",
          content: assistantBuf.slice(0, 50_000),
          at: new Date().toISOString(),
        },
      ]);
    }

    res.end();
  } catch (e) {
    if (!res.headersSent) {
      res.status(502).json({
        error: "cloud→agent proxy failed",
        detail: e instanceof Error ? e.message : String(e),
      });
    } else {
      res.end();
    }
  }
}

app.post("/v1/agent", optionalAuth, (req, res) => proxyAgent(req, res, "/v1/agent"));
app.post("/api/agent/chat", optionalAuth, (req, res) => proxyAgent(req, res, "/v1/agent"));

app.post("/v1/confirm", optionalAuth, async (req, res) => {
  try {
    const upstream = await fetch(`${cloudConfig.agentUrl}/v1/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body ?? {}),
    });
    const text = await upstream.text();
    res.status(upstream.status).type(upstream.headers.get("content-type") || "application/json").send(text);
  } catch (e) {
    res.status(502).json({
      error: "confirm proxy failed",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
});

app.get("/api/agent/health", async (_req, res) => {
  try {
    const r = await fetch(`${cloudConfig.agentUrl}/health`);
    const j = await r.json();
    res.status(r.status).json({ cloud: true, agent: j });
  } catch (e) {
    res.status(502).json({
      cloud: true,
      agent: null,
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

// Landing + admin + developer consoles
app.use(express.static(path.join(wwwRoot, "home")));
app.use("/admin", express.static(path.join(wwwRoot, "admin")));
app.use("/dev", express.static(path.join(wwwRoot, "dev")));
app.get("/admin", (_req, res) => res.redirect("/admin/"));
app.get("/dev", (_req, res) => res.redirect("/dev/"));
app.get("/", (_req, res) => {
  res.sendFile(path.join(wwwRoot, "home", "index.html"));
});

app.listen(cloudConfig.port, cloudConfig.host, () => {
  console.log(
    `[5tick-cloud] http://${cloudConfig.host}:${cloudConfig.port} → public ${cloudConfig.publicBaseUrl}`,
  );
  console.log(`[5tick-cloud] auth:`, JSON.stringify(authStatus()));
  console.log(`[5tick-cloud] agent: ${cloudConfig.agentUrl}`);
});
