import * as vscode from "vscode";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";

const DEFAULT_URL = "http://127.0.0.1:3847";
const OLLAMA_TAGS = "http://127.0.0.1:11434/api/tags";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function httpOk(url: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const u = new URL(url);
    await new Promise<void>((resolve, reject) => {
      const req = http.get(u, { timeout: timeoutMs }, (res) => {
        res.resume();
        res.statusCode && res.statusCode >= 200 && res.statusCode < 500
          ? resolve()
          : reject(new Error(`status ${res.statusCode}`));
      });
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("timeout"));
      });
    });
    return true;
  } catch {
    return false;
  }
}

async function healthOk(agentUrl: string): Promise<boolean> {
  try {
    const u = new URL("/health", agentUrl);
    const body = await new Promise<string>((resolve, reject) => {
      const req = http.get(u, { timeout: 1500 }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      });
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("timeout"));
      });
    });
    const json = JSON.parse(body) as { ok?: boolean };
    return Boolean(json.ok);
  } catch {
    return false;
  }
}

function resolveBundledAgentDir(extensionPath: string): string | undefined {
  const candidates = [
    path.resolve(extensionPath, "..", "..", "5tick-agent"),
    path.resolve(extensionPath, "..", "5tick-agent"),
    path.resolve(extensionPath, "5tick-agent"),
    path.resolve(extensionPath, "..", "agent"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "dist", "index.js")) || fs.existsSync(path.join(c, "agent.mjs"))) {
      return c;
    }
  }
  return undefined;
}

function resolveNodeBinary(agentDir: string): string {
  const win = process.platform === "win32";
  const bundled = path.join(agentDir, "runtime", win ? "node.exe" : "node");
  if (fs.existsSync(bundled)) return bundled;
  return win ? "node.exe" : "node";
}

function resolveOllamaBinary(): string | undefined {
  const win = process.platform === "win32";
  const local = process.env.LOCALAPPDATA || "";
  const pf = process.env.ProgramFiles || "";
  const candidates = [
    path.join(local, "Programs", "Ollama", win ? "ollama.exe" : "ollama"),
    path.join(pf, "Ollama", win ? "ollama.exe" : "ollama"),
    win ? "ollama.exe" : "ollama",
  ];
  for (const c of candidates) {
    if (c === "ollama" || c === "ollama.exe") return c;
    if (fs.existsSync(c)) return c;
  }
  return undefined;
}

function usesLocalOllama(apiBase: string): boolean {
  return /127\.0\.0\.1:11434|localhost:11434/i.test(apiBase);
}

export class AgentHost implements vscode.Disposable {
  private child: ChildProcessWithoutNullStreams | null = null;
  private output: vscode.OutputChannel;

  constructor(private readonly extensionPath: string) {
    this.output = vscode.window.createOutputChannel("5Tick Agent");
  }

  private async ensureOllama(apiBase: string): Promise<void> {
    if (!usesLocalOllama(apiBase)) return;
    if (await httpOk(OLLAMA_TAGS, 2000)) {
      this.output.appendLine("[5Tick] Ollama already running");
      return;
    }
    const bin = resolveOllamaBinary();
    if (!bin) {
      this.output.appendLine("[5Tick] Ollama not found — install from https://ollama.com");
      void vscode.window.showWarningMessage(
        "Ollama is not running and was not found. Install Ollama or start it manually.",
      );
      return;
    }
    this.output.appendLine(`[5Tick] starting Ollama: ${bin} serve`);
    spawn(bin, ["serve"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      if (await httpOk(OLLAMA_TAGS, 2000)) {
        this.output.appendLine("[5Tick] Ollama ready");
        return;
      }
    }
    this.output.appendLine("[5Tick] Ollama did not become ready in time");
  }

  async ensureRunning(): Promise<string> {
    const cfg = vscode.workspace.getConfiguration("fiveTick");
    const agentUrl = (cfg.get<string>("agentUrl", DEFAULT_URL) || DEFAULT_URL).replace(/\/$/, "");

    const apiBaseCfg = cfg.get<string>("apiBase", "")?.trim() || "";
    const apiKey = cfg.get<string>("apiKey", "")?.trim() || "";
    const model = cfg.get<string>("model", "")?.trim() || "";
    const uncensored = cfg.get<boolean>("uncensoredPreset", true);

    let apiBase = apiBaseCfg;
    if (uncensored && !apiBase) {
      apiBase = "http://127.0.0.1:11434/v1";
    }

    // Always try to bring Ollama up when using local endpoint (even if agent already up)
    const effectiveBaseForOllama = apiBase || "http://127.0.0.1:11434/v1";
    await this.ensureOllama(effectiveBaseForOllama);

    if (await healthOk(agentUrl)) {
      this.output.appendLine(`[5Tick] agent already up at ${agentUrl}`);
      return agentUrl;
    }

    const agentDir = resolveBundledAgentDir(this.extensionPath);
    if (!agentDir) {
      this.output.appendLine("[5Tick] bundled agent not found — start with npm run agent");
      void vscode.window.showWarningMessage(
        "5Tick agent is not running. Start it with npm run agent, or use a packaged 5Tick IDE build.",
      );
      return agentUrl;
    }

    const nodeBin = resolveNodeBinary(agentDir);
    const entryMjs = path.join(agentDir, "agent.mjs");
    const entryDist = path.join(agentDir, "dist", "index.js");
    const entry = fs.existsSync(entryMjs) ? entryMjs : entryDist;
    const envFile = path.join(agentDir, ".env");

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      FIVETICK_HOST: "127.0.0.1",
      FIVETICK_PORT: new URL(agentUrl).port || "3847",
    };
    if (apiBase) env.FIVETICK_API_BASE = apiBase;
    if (apiKey) env.FIVETICK_API_KEY = apiKey;
    else if (uncensored) env.FIVETICK_API_KEY = "ollama";
    if (model) env.FIVETICK_MODEL = model;
    else if (uncensored) env.FIVETICK_MODEL = "dolphin-llama3:8b";
    if (fs.existsSync(envFile)) {
      env.DOTENV_CONFIG_PATH = envFile;
    }

    this.output.appendLine(`[5Tick] starting bundled agent: ${nodeBin} ${entry}`);
    this.output.show(true);

    this.child = spawn(nodeBin, [entry], {
      cwd: agentDir,
      env,
      windowsHide: true,
      stdio: "pipe",
    });
    this.child.stdout.on("data", (d) => this.output.append(d.toString()));
    this.child.stderr.on("data", (d) => this.output.append(d.toString()));
    this.child.on("exit", (code) => {
      this.output.appendLine(`[5Tick] agent exited code=${code}`);
      this.child = null;
    });

    for (let i = 0; i < 40; i++) {
      await sleep(300);
      if (await healthOk(agentUrl)) {
        this.output.appendLine(`[5Tick] agent ready at ${agentUrl}`);
        return agentUrl;
      }
    }

    void vscode.window.showWarningMessage(
      "5Tick agent did not become healthy in time. Check the “5Tick Agent” output channel.",
    );
    return agentUrl;
  }

  dispose(): void {
    this.output.dispose();
  }
}
