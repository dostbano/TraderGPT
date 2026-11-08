import * as vscode from "vscode";

/** Show agent shell commands in a dedicated VS Code terminal (visibility). */
export class TerminalMirror {
  private terminal?: vscode.Terminal;

  mirror(command: string, cwd?: string): void {
    if (!command.trim()) return;
    const term = this.ensure();
    term.show(true);
    const prefix = cwd ? `# cwd: ${cwd}\n` : "";
    // Echo only — agent already executed on the server for tool results.
    term.sendText(`${prefix}Write-Host "[5Tick] ${command.replace(/"/g, '`"')}"`, true);
  }

  runInteractively(command: string): void {
    if (!command.trim()) return;
    const term = this.ensure();
    term.show(true);
    term.sendText(command, true);
  }

  private ensure(): vscode.Terminal {
    if (!this.terminal || this.terminal.exitStatus !== undefined) {
      this.terminal = vscode.window.createTerminal({ name: "5Tick" });
    }
    return this.terminal;
  }

  dispose(): void {
    this.terminal?.dispose();
  }
}
