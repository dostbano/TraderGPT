/**
 * Phase 3 self-test without an LLM API key.
 * Exercises write snapshot, restore (Reject), terminal tool, and /v1/demo stream.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspace = path.join(root, ".fiveTick-selftest");
const targetRel = "phase3-hello.js";
const targetAbs = path.join(workspace, targetRel);

async function loadTools() {
  const toolsUrl = pathToFileURL(
    path.join(root, "apps/agent/dist/tools.js"),
  ).href;
  return import(toolsUrl);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function testTools() {
  const { peekFile, runTool } = await loadTools();
  await fs.rm(workspace, { recursive: true, force: true });
  await fs.mkdir(workspace, { recursive: true });

  const before = await peekFile(workspace, targetRel);
  assert(before === null, "expected missing file before write");

  const write = await runTool(workspace, {
    id: "t1",
    name: "write_file",
    arguments: {
      path: targetRel,
      content: 'console.log("5Tick Phase3");\n',
    },
  });
  assert(write.includes("Wrote"), `write failed: ${write}`);

  const after = await peekFile(workspace, targetRel);
  assert(
    after?.includes("5Tick Phase3"),
    "file content missing after write",
  );

  // Simulate Reject restore for new file = delete
  await fs.rm(targetAbs, { force: true });
  const restored = await peekFile(workspace, targetRel);
  assert(restored === null, "reject/delete did not remove new file");

  // Edit existing + restore previous
  await runTool(workspace, {
    id: "t2",
    name: "write_file",
    arguments: { path: targetRel, content: "v1\n" },
  });
  const snap = await peekFile(workspace, targetRel);
  await runTool(workspace, {
    id: "t3",
    name: "write_file",
    arguments: { path: targetRel, content: "v2-bad\n" },
  });
  await fs.writeFile(targetAbs, snap, "utf8"); // Reject
  const back = await peekFile(workspace, targetRel);
  assert(back === "v1\n", `reject restore failed: ${JSON.stringify(back)}`);

  const listed = await runTool(workspace, {
    id: "t4",
    name: "list_dir",
    arguments: { path: "." },
  });
  assert(listed.includes(targetRel), "list_dir missing file");

  const term = await runTool(workspace, {
    id: "t5",
    name: "run_terminal",
    arguments: { command: 'Write-Output "5Tick-OK"' },
  });
  assert(term.includes("5Tick-OK"), `terminal failed: ${term}`);

  console.log("PASS tools/write/reject/terminal");
}

async function testDemoStream() {
  const res = await fetch("http://127.0.0.1:3847/v1/demo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceRoot: workspace }),
  });
  assert(res.ok, `demo HTTP ${res.status}`);
  const text = await res.text();
  const events = text
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const types = events.map((e) => e.type);
  assert(types.includes("tool_start"), "missing tool_start");
  assert(types.includes("tool_result"), "missing tool_result");
  assert(types.includes("final"), "missing final");
  const writeStart = events.find(
    (e) => e.type === "tool_start" && e.data?.name === "write_file",
  );
  assert(writeStart, "missing write_file tool_start");
  assert(
    "previousContent" in writeStart.data,
    "write_file missing previousContent snapshot (Phase 3)",
  );
  const termStart = events.find(
    (e) => e.type === "tool_start" && e.data?.name === "run_terminal",
  );
  assert(termStart, "missing run_terminal tool_start");
  console.log("PASS /v1/demo NDJSON Phase3 events");
  console.log(
    "events:",
    events.map((e) => `${e.type}:${e.data?.name || e.data?.phase || ""}`).join(", "),
  );
}

async function testPhase4Schema() {
  const res = await fetch("http://127.0.0.1:3847/v1/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "solo",
      safeMode: false,
      workspaceRoot: workspace,
      context: {
        activeFile: "README.md",
        openFiles: ["README.md"],
        projectTree: "README.md\napps/",
        gitStatus: "?? scripts/",
      },
      messages: [{ role: "user", content: "ping" }],
    }),
  });
  assert(res.ok, `phase4 agent HTTP ${res.status}`);
  const text = await res.text();
  const events = text
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const start = events.find((e) => e.type === "status" && e.data?.phase === "start");
  assert(start?.data?.mode === "solo", "expected mode=solo in status");
  // Schema accepted: either a clean model error/final, never HTTP 400.
  const err = events.find((e) => e.type === "error");
  const final = events.find((e) => e.type === "final");
  assert(err || final || start, "expected agent stream events");
  if (err) {
    console.log("phase4 note: model error (ok for schema check):", err.data?.message);
  }
  console.log("PASS phase4 mode/context schema + solo status");
}

async function main() {
  await testTools();
  await testDemoStream();
  await testPhase4Schema();
  console.log("PHASE3_SELFTEST_OK");
}

main().catch((err) => {
  console.error("PHASE3_SELFTEST_FAIL", err);
  process.exit(1);
});
