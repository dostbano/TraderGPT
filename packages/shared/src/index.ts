export type Role = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: Role;
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type ToolName =
  | "read_file"
  | "write_file"
  | "list_dir"
  | "search"
  | "run_terminal"
  | "web_fetch"
  | "web_search";

/** Tools allowed in Ask mode (live web; no workspace writes). */
export const ASK_TOOL_NAMES: ToolName[] = ["web_fetch", "web_search"];

export type AgentMode = "ask" | "ide" | "solo";

export interface WorkspaceContext {
  openFiles?: string[];
  activeFile?: string;
  selection?: string;
  gitStatus?: string;
  projectTree?: string;
}

export interface ToolDefinition {
  name: ToolName;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "read_file",
    description: "Read a UTF-8 text file relative to the workspace root.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Create or overwrite a UTF-8 text file relative to the workspace root.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path" },
        content: { type: "string", description: "Full file contents" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "list_dir",
    description: "List files and folders in a directory relative to the workspace root.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative directory path (default .)" },
      },
    },
  },
  {
    name: "search",
    description: "Search for a text pattern across the workspace (case-insensitive).",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search string" },
        path: { type: "string", description: "Optional subdirectory to search in" },
        maxResults: { type: "number", description: "Max matches (default 40)" },
      },
      required: ["query"],
    },
  },
  {
    name: "run_terminal",
    description: "Run a shell command in the workspace. Prefer safe, non-destructive commands.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Command to run" },
        cwd: { type: "string", description: "Optional relative working directory" },
      },
      required: ["command"],
    },
  },
  {
    name: "web_fetch",
    description:
      "Fetch a public https URL and return readable text (for live prices, news, docs). Use for sites like investing.com.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Full https URL to fetch" },
        maxChars: { type: "number", description: "Max characters to return (default 12000)" },
      },
      required: ["url"],
    },
  },
  {
    name: "web_search",
    description:
      "Search the public web for current information (prices, news, docs). Prefer this before guessing live data.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        maxResults: { type: "number", description: "Max results (default 5)" },
      },
      required: ["query"],
    },
  },
];

/** Optional per-request LLM provider override (secrets come from server; never from browser). */
export interface ModelProviderOverride {
  apiBase?: string;
  apiKey?: string;
  model?: string;
  providerId?: string;
}

export interface AgentRequest {
  messages: ChatMessage[];
  workspaceRoot?: string;
  maxSteps?: number;
  mode?: AgentMode;
  context?: WorkspaceContext;
  /** Correlate confirmations / cancel for this run */
  requestId?: string;
  /** Ask IDE before write_file / run_terminal (default: server FIVETICK_SAFE_MODE) */
  safeMode?: boolean;
  /** Switch OpenAI / Ollama / OpenRouter for this run */
  modelProvider?: ModelProviderOverride;
}

export interface AgentEvent {
  type:
    | "status"
    | "assistant_delta"
    | "tool_start"
    | "tool_result"
    | "confirm_required"
    | "final"
    | "error"
    | "cancelled";
  data: unknown;
}

/** IDE-side review payload (extension emits UI; not required on the wire). */
export interface PatchReviewPayload {
  id: string;
  path: string;
  created: boolean;
  preview: string;
}

export interface HealthResponse {
  ok: true;
  product: "5Tick";
  model: string;
  apiBase: string;
  workspace: string;
}
