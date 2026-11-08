import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";

const execAsync = promisify(exec);

export interface CollectedContext {
  openFiles: string[];
  activeFile?: string;
  selection?: string;
  gitStatus?: string;
  projectTree?: string;
}

function rel(root: string, fsPath: string): string {
  const normalizedRoot = root.replace(/[\\/]+$/, "");
  if (fsPath.toLowerCase().startsWith(normalizedRoot.toLowerCase())) {
    return fsPath.slice(normalizedRoot.length).replace(/^[\\/]/, "") || ".";
  }
  return fsPath;
}

async function gitStatus(root: string): Promise<string | undefined> {
  try {
    const { stdout } = await execAsync("git status --short", {
      cwd: root,
      timeout: 5000,
      windowsHide: true,
    });
    return stdout.trim() || "(clean)";
  } catch {
    return undefined;
  }
}

async function projectTree(root: string): Promise<string | undefined> {
  try {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return undefined;
    const entries = await vscode.workspace.fs.readDirectory(folder.uri);
    const lines: string[] = [];
    const skip = new Set([
      "node_modules",
      ".git",
      "dist",
      "out",
      ".fiveTick-selftest",
    ]);
    for (const [name, type] of entries.slice(0, 80)) {
      if (skip.has(name)) continue;
      const tag = type === vscode.FileType.Directory ? "/" : "";
      lines.push(`${name}${tag}`);
      if (type === vscode.FileType.Directory && lines.length < 60) {
        try {
          const sub = await vscode.workspace.fs.readDirectory(
            vscode.Uri.joinPath(folder.uri, name),
          );
          for (const [child, childType] of sub.slice(0, 12)) {
            if (skip.has(child)) continue;
            lines.push(
              `  ${child}${childType === vscode.FileType.Directory ? "/" : ""}`,
            );
          }
        } catch {
          // ignore
        }
      }
    }
    return lines.join("\n") || undefined;
  } catch {
    return undefined;
  }
}

export async function collectWorkspaceContext(
  workspaceRoot: string,
): Promise<CollectedContext> {
  const openFiles = vscode.window.visibleTextEditors
    .map((e) => rel(workspaceRoot, e.document.uri.fsPath))
    .filter((p, i, arr) => arr.indexOf(p) === i)
    .slice(0, 20);

  const active = vscode.window.activeTextEditor;
  const activeFile = active
    ? rel(workspaceRoot, active.document.uri.fsPath)
    : undefined;

  let selection: string | undefined;
  if (active && !active.selection.isEmpty) {
    selection = active.document.getText(active.selection).slice(0, 4000);
  }

  const [git, tree] = await Promise.all([
    gitStatus(workspaceRoot),
    projectTree(workspaceRoot),
  ]);

  return {
    openFiles,
    activeFile,
    selection,
    gitStatus: git,
    projectTree: tree,
  };
}
