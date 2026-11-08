import * as vscode from "vscode";
import { DiffContentProvider } from "./diffContentProvider";

export interface PendingEdit {
  id: string;
  relativePath: string;
  absolutePath: string;
  previousContent: string | null; // null = file did not exist
  nextContent: string;
  status: "pending" | "accepted" | "rejected";
}

export class EditReviewController {
  private readonly pending = new Map<string, PendingEdit>();

  constructor(private readonly diffs: DiffContentProvider) {}

  async beginWrite(
    id: string,
    workspaceRoot: string,
    relativePath: string,
    nextContent: string,
    snapshot?: string | null,
  ): Promise<PendingEdit> {
    const absolutePath = vscode.Uri.joinPath(
      vscode.Uri.file(workspaceRoot),
      ...relativePath.split(/[/\\]/).filter(Boolean),
    ).fsPath;

    let previousContent: string | null;
    if (snapshot !== undefined) {
      previousContent = snapshot;
    } else {
      try {
        const uri = vscode.Uri.file(absolutePath);
        const buf = await vscode.workspace.fs.readFile(uri);
        previousContent = Buffer.from(buf).toString("utf8");
      } catch {
        previousContent = null;
      }
    }

    const edit: PendingEdit = {
      id,
      relativePath: relativePath.replace(/\\/g, "/"),
      absolutePath,
      previousContent,
      nextContent,
      status: "pending",
    };
    this.pending.set(id, edit);
    this.diffs.set(id, previousContent ?? "");
    return edit;
  }

  get(id: string): PendingEdit | undefined {
    return this.pending.get(id);
  }

  async accept(id: string): Promise<string> {
    const edit = this.pending.get(id);
    if (!edit) return "Unknown edit";
    if (edit.status === "rejected") return "Already rejected";
    edit.status = "accepted";

    const uri = vscode.Uri.file(edit.absolutePath);
    const autoOpen = vscode.workspace
      .getConfiguration("fiveTick")
      .get<boolean>("autoOpenChangedFiles", true);
    if (autoOpen) {
      await vscode.window.showTextDocument(uri, { preview: true });
    }
    return `Accepted ${edit.relativePath}`;
  }

  async reject(id: string): Promise<string> {
    const edit = this.pending.get(id);
    if (!edit) return "Unknown edit";
    if (edit.status === "rejected") return "Already rejected";
    edit.status = "rejected";

    const uri = vscode.Uri.file(edit.absolutePath);
    if (edit.previousContent === null) {
      try {
        await vscode.workspace.fs.delete(uri, { useTrash: true });
      } catch {
        // may already be gone
      }
    } else {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(edit.previousContent, "utf8"));
    }
    this.diffs.clear(id);
    return `Rejected ${edit.relativePath} (restored)`;
  }

  async openDiff(id: string): Promise<void> {
    const edit = this.pending.get(id);
    if (!edit) {
      void vscode.window.showWarningMessage("5Tick: edit not found");
      return;
    }
    const left = this.diffs.set(id, edit.previousContent ?? "");
    const right = vscode.Uri.file(edit.absolutePath);
    await vscode.commands.executeCommand(
      "vscode.diff",
      left,
      right,
      `5Tick: ${edit.relativePath} (before ↔ after)`,
    );
  }

  clear(): void {
    for (const id of this.pending.keys()) this.diffs.clear(id);
    this.pending.clear();
  }
}
