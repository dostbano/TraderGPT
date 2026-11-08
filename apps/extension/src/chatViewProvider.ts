import * as vscode from "vscode";
import { collectWorkspaceContext } from "./contextCollector";
import { DiffContentProvider } from "./diffContentProvider";
import { EditReviewController } from "./editReview";
import { TerminalMirror } from "./terminalMirror";

interface AgentEvent {
  type: string;
  data: unknown;
}

type AgentMode = "ask" | "ide" | "solo";

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "fiveTick.chat";
  private view?: vscode.WebviewView;
  private history: Array<{ role: "user" | "assistant"; content: string }> = [];
  private readonly diffs = new DiffContentProvider();
  private readonly edits = new EditReviewController(this.diffs);
  private readonly terminal = new TerminalMirror();
  private workspaceRoot = "";
  private mode: AgentMode = "ide";
  private abort?: AbortController;
  private running = false;

  constructor(private readonly extensionUri: vscode.Uri) {
    const configured = vscode.workspace
      .getConfiguration("fiveTick")
      .get<string>("defaultMode", "ide");
    this.mode =
      configured === "solo" || configured === "ask" ? (configured as AgentMode) : "ide";
  }

  get diffProvider(): DiffContentProvider {
    return this.diffs;
  }

  dispose(): void {
    this.abort?.abort();
    this.terminal.dispose();
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (msg?.type === "ready") {
        this.post({ type: "mode", mode: this.mode });
        return;
      }
      if (
        msg?.type === "set_mode" &&
        (msg.mode === "ide" || msg.mode === "solo" || msg.mode === "ask")
      ) {
        this.mode = msg.mode;
        this.post({ type: "mode", mode: this.mode });
        this.post({
          type: "status",
          text:
            this.mode === "solo"
              ? "SOLO mode"
              : this.mode === "ask"
                ? "ASK mode"
                : "IDE mode",
        });
        return;
      }
      if (msg?.type === "clear") {
        this.history = [];
        this.edits.clear();
        return;
      }
      if (msg?.type === "stop") {
        this.abort?.abort();
        this.post({ type: "status", text: "Stopping…" });
        return;
      }
      if (msg?.type === "send" && typeof msg.text === "string") {
        await this.runTask(msg.text);
        return;
      }
      if (msg?.type === "accept" && typeof msg.id === "string") {
        const text = await this.edits.accept(msg.id);
        this.post({ type: "patch_status", id: msg.id, status: "accepted", text });
        return;
      }
      if (msg?.type === "reject" && typeof msg.id === "string") {
        const text = await this.edits.reject(msg.id);
        this.post({ type: "patch_status", id: msg.id, status: "rejected", text });
        return;
      }
      if (msg?.type === "diff" && typeof msg.id === "string") {
        await this.edits.openDiff(msg.id);
        return;
      }
      if (msg?.type === "run_in_terminal" && typeof msg.command === "string") {
        this.terminal.runInteractively(msg.command);
      }
    });
  }

  async runTask(text: string): Promise<void> {
    if (this.running) {
      this.post({ type: "error", text: "Agent already running. Press Stop first." });
      return;
    }

    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      this.post({ type: "error", text: "Open a folder/workspace first." });
      return;
    }

    this.workspaceRoot = folder.uri.fsPath;
    const cfg = vscode.workspace.getConfiguration("fiveTick");
    const useCloud = cfg.get<boolean>("useCloudAgent", false);
    const cloudUrl = (cfg.get<string>("cloudUrl", "https://ai.11tick.com") || "")
      .replace(/\/$/, "");
    const localUrl = (cfg.get<string>("agentUrl", "http://127.0.0.1:3847") || "")
      .replace(/\/$/, "");
    const agentUrl = useCloud && cloudUrl ? cloudUrl : localUrl;
    const safeMode = this.mode === "ask" ? false : cfg.get<boolean>("safeMode", true);
    const requestId = `ext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const token = cfg.get<string>("authToken", "") || "";

    const context = await collectWorkspaceContext(folder.uri.fsPath);
    this.history.push({ role: "user", content: text });
    this.post({
      type: "status",
      text: `${this.mode.toUpperCase()} → ${agentUrl}${useCloud ? " (cloud)" : ""}`,
    });
    this.post({
      type: "tool",
      text: `context: active=${context.activeFile || "-"} open=${context.openFiles.length} git=${context.gitStatus ? "yes" : "no"} safeMode=${safeMode}`,
    });

    this.abort = new AbortController();
    this.running = true;
    this.post({ type: "running", running: true });

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${agentUrl}/v1/agent`, {
        method: "POST",
        headers,
        signal: this.abort.signal,
        body: JSON.stringify({
          workspaceRoot: folder.uri.fsPath,
          messages: this.history,
          mode: this.mode,
          context,
          requestId,
          safeMode,
          maxSteps: this.mode === "solo" ? 24 : this.mode === "ask" ? 1 : undefined,
          projectKey: folder.uri.fsPath,
        }),
      });

      if (!res.ok || !res.body) {
        const errText = await res.text();
        throw new Error(errText || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let event: AgentEvent;
          try {
            event = JSON.parse(line) as AgentEvent;
          } catch {
            continue;
          }
          await this.handleEvent(event, agentUrl);
          if (event.type === "final") {
            const data = event.data as { text?: string };
            finalText = data.text || finalText;
          }
          if (event.type === "assistant_delta") {
            const data = event.data as { text?: string };
            if (data.text) finalText = data.text;
          }
        }
      }

      if (finalText) {
        this.history.push({ role: "assistant", content: finalText });
      }
      this.post({ type: "done", text: "Ready" });
    } catch (err) {
      const aborted =
        (err instanceof Error && err.name === "AbortError") ||
        this.abort?.signal.aborted;
      if (aborted) {
        this.post({ type: "assistant", text: "Stopped by user." });
        this.post({ type: "done", text: "Stopped" });
      } else {
        this.post({
          type: "error",
          text:
            (err instanceof Error ? err.message : String(err)) +
            " — Is the 5Tick agent running? (npm run agent)",
        });
        this.post({ type: "done", text: "Error" });
      }
    } finally {
      this.running = false;
      this.post({ type: "running", running: false });
    }
  }

  private async handleEvent(event: AgentEvent, agentUrl: string): Promise<void> {
    const data = event.data as Record<string, unknown>;
    switch (event.type) {
      case "status":
        this.post({
          type: "status",
          text: `mode=${String(data.mode ?? this.mode)} step=${String(data.step ?? data.phase ?? "")} model=${String(data.model ?? "")}`,
        });
        break;
      case "assistant_delta":
        this.post({ type: "assistant", text: String(data.text ?? "") });
        break;
      case "confirm_required": {
        const id = String(data.id ?? "");
        const name = String(data.name ?? "");
        const requestId = String(data.requestId ?? "");
        const args = data.arguments ?? {};
        const detail =
          name === "write_file"
            ? `Write ${String((args as { path?: string }).path ?? "?")}`
            : `Run: ${String((args as { command?: string }).command ?? "?")}`;
        const choice = await vscode.window.showWarningMessage(
          `5Tick safe mode: allow ${name}?`,
          { modal: true, detail },
          "Allow",
          "Deny",
        );
        const approved = choice === "Allow";
        this.post({
          type: "tool",
          text: approved ? `Allowed ${name}` : `Denied ${name}`,
        });
        try {
          await fetch(`${agentUrl}/v1/confirm`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              requestId,
              toolCallId: id,
              approved,
            }),
          });
        } catch (err) {
          this.post({
            type: "error",
            text: `Confirm failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        break;
      }
      case "tool_start": {
        const name = String(data.name ?? "");
        const id = String(data.id ?? "");
        const args = (data.arguments ?? {}) as Record<string, unknown>;
        this.post({
          type: "tool",
          text: `→ ${name} ${JSON.stringify(summarizeArgs(name, args))}`,
        });

        if (name === "write_file" && id) {
          const rel = String(args.path ?? "");
          const content = String(args.content ?? "");
          const snapshot =
            "previousContent" in data
              ? ((data.previousContent as string | null) ?? null)
              : undefined;
          // Snapshot now; patch card appears after a successful write.
          await this.edits.beginWrite(
            id,
            this.workspaceRoot,
            rel,
            content,
            snapshot,
          );
        }

        if (name === "run_terminal") {
          const command = String(args.command ?? "");
          const cwd = args.cwd ? String(args.cwd) : undefined;
          const mirror = vscode.workspace
            .getConfiguration("fiveTick")
            .get<boolean>("mirrorTerminal", true);
          if (mirror) this.terminal.mirror(command, cwd);
          this.post({
            type: "terminal",
            command,
            text: `Terminal: ${command}`,
          });
        }
        break;
      }
      case "tool_result": {
        const name = String(data.name ?? "");
        const id = String(data.id ?? "");
        this.post({
          type: "tool",
          text: `← ${name}: ${String(data.result ?? "").slice(0, 1200)}`,
        });
        if (name === "write_file" && id) {
          const edit = this.edits.get(id);
          const resultText = String(data.result ?? "");
          const applied =
            edit &&
            !/Rejected|Cancelled|Tool error/i.test(resultText);
          if (applied && edit) {
            this.post({
              type: "patch",
              id,
              path: edit.relativePath,
              created: edit.previousContent === null,
              preview: edit.nextContent.slice(0, 400),
            });
            const autoOpen = vscode.workspace
              .getConfiguration("fiveTick")
              .get<boolean>("autoOpenChangedFiles", true);
            if (autoOpen) {
              try {
                await vscode.window.showTextDocument(
                  vscode.Uri.file(edit.absolutePath),
                  { preview: true, preserveFocus: true },
                );
              } catch {
                // ignore
              }
            }
            const showDiff = vscode.workspace
              .getConfiguration("fiveTick")
              .get<boolean>("showDiffOnWrite", false);
            if (showDiff) await this.edits.openDiff(id);
          }
        }
        break;
      }
      case "final":
        this.post({ type: "assistant", text: String(data.text ?? "Done.") });
        break;
      case "cancelled":
        this.post({ type: "assistant", text: "Run cancelled." });
        break;
      case "error":
        this.post({ type: "error", text: String(data.message ?? "Agent error") });
        break;
      default:
        break;
    }
  }

  private post(msg: Record<string, unknown>): void {
    void this.view?.webview.postMessage(msg);
  }

  private getHtml(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "chat.css"),
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "chat.js"),
    );
    const nonce = String(Date.now());

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>5Tick</title>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <div class="brand">5Tick</div>
      <div class="status" id="status">Ready</div>
    </div>
    <div class="modes" id="modes">
      <button type="button" class="mode-btn" data-mode="ask" id="mode-ask">ASK</button>
      <button type="button" class="mode-btn active" data-mode="ide" id="mode-ide">IDE</button>
      <button type="button" class="mode-btn" data-mode="solo" id="mode-solo">SOLO</button>
    </div>
    <div class="mode-hint" id="mode-hint">IDE: you drive — agent helps on request.</div>
    <div class="log" id="log"></div>
    <div class="composer">
      <textarea id="input" placeholder="Ask 5Tick to edit code, create files, search, or run commands… (Ctrl+Enter)"></textarea>
      <div class="row">
        <button id="send">Run Agent</button>
        <button id="stop" class="secondary" disabled>Stop</button>
        <button id="clear" class="secondary">Clear</button>
      </div>
    </div>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function summarizeArgs(
  name: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (name === "write_file") {
    return {
      path: args.path,
      bytes: String(args.content ?? "").length,
    };
  }
  return args;
}
