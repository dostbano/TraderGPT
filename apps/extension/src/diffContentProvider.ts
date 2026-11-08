import * as vscode from "vscode";

/** Virtual documents holding pre-edit content for vscode.diff */
export class DiffContentProvider implements vscode.TextDocumentContentProvider {
  public static readonly scheme = "fivetick-diff";
  private readonly contents = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();

  readonly onDidChange = this.emitter.event;

  set(id: string, content: string): vscode.Uri {
    const key = sanitizeId(id);
    this.contents.set(key, content);
    const uri = vscode.Uri.from({
      scheme: DiffContentProvider.scheme,
      path: `/${key}`,
    });
    this.emitter.fire(uri);
    return uri;
  }

  clear(id: string): void {
    this.contents.delete(sanitizeId(id));
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    const key = uri.path.replace(/^\//, "");
    return this.contents.get(key) ?? "";
  }
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, "_");
}
