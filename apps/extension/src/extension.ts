import * as vscode from "vscode";
import { AgentHost } from "./agentHost";
import { ChatViewProvider } from "./chatViewProvider";
import { DiffContentProvider } from "./diffContentProvider";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const provider = new ChatViewProvider(context.extensionUri);
  const agentHost = new AgentHost(context.extensionPath);
  context.subscriptions.push(agentHost);

  // Auto-start bundled agent inside the IDE (Phase 7.4)
  void agentHost.ensureRunning();

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      DiffContentProvider.scheme,
      provider.diffProvider,
    ),
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("fiveTick.openChat", async () => {
      await vscode.commands.executeCommand("fiveTick.chat.focus");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("fiveTick.runTask", async () => {
      await agentHost.ensureRunning();
      const text = await vscode.window.showInputBox({
        title: "5Tick Agent Task",
        prompt: "Describe what 5Tick should do in this workspace",
        placeHolder: "Create hello.js that prints 5Tick",
      });
      if (!text) return;
      await vscode.commands.executeCommand("fiveTick.chat.focus");
      await provider.runTask(text);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("fiveTick.setAgentUrl", async () => {
      const current = vscode.workspace
        .getConfiguration("fiveTick")
        .get<string>("agentUrl", "http://127.0.0.1:3847");
      const next = await vscode.window.showInputBox({
        title: "5Tick Agent URL",
        value: current,
      });
      if (!next) return;
      await vscode.workspace
        .getConfiguration("fiveTick")
        .update("agentUrl", next, vscode.ConfigurationTarget.Global);
      void vscode.window.showInformationMessage(`5Tick agent URL set to ${next}`);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("fiveTick.ensureAgent", async () => {
      const url = await agentHost.ensureRunning();
      void vscode.window.showInformationMessage(`5Tick agent: ${url}`);
    }),
  );

  context.subscriptions.push({ dispose: () => provider.dispose() });
}

export function deactivate(): void {}
