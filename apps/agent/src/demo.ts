import type { AgentEvent } from "@5tick/shared";
import { peekFile, runTool } from "./tools.js";

/** Deterministic Phase 3 stream for self-test / UI smoke (no LLM). */
export async function* runDemo(workspaceRoot: string): AsyncGenerator<AgentEvent> {
  yield {
    type: "status",
    data: { phase: "start", workspaceRoot, model: "demo", mode: "demo" },
  };

  const rel = "phase3-demo.js";
  const content = 'console.log("5Tick demo");\n';
  let previousContent: string | null = null;
  try {
    previousContent = await peekFile(workspaceRoot, rel);
  } catch {
    previousContent = null;
  }

  const writeId = "demo-write-1";
  yield {
    type: "tool_start",
    data: {
      id: writeId,
      name: "write_file",
      arguments: { path: rel, content },
      previousContent,
    },
  };
  const writeResult = await runTool(workspaceRoot, {
    id: writeId,
    name: "write_file",
    arguments: { path: rel, content },
  });
  yield {
    type: "tool_result",
    data: { id: writeId, name: "write_file", result: writeResult },
  };

  const termId = "demo-term-1";
  const command = 'Write-Output "5Tick-demo-terminal"';
  yield {
    type: "tool_start",
    data: {
      id: termId,
      name: "run_terminal",
      arguments: { command },
    },
  };
  const termResult = await runTool(workspaceRoot, {
    id: termId,
    name: "run_terminal",
    arguments: { command },
  });
  yield {
    type: "tool_result",
    data: { id: termId, name: "run_terminal", result: termResult },
  };

  yield {
    type: "assistant_delta",
    data: {
      text: "Demo complete: wrote phase3-demo.js and ran a terminal command.",
    },
  };
  yield {
    type: "final",
    data: {
      text: "Demo complete: wrote phase3-demo.js and ran a terminal command.",
      steps: 1,
    },
  };
}
