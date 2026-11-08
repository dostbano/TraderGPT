(function () {
  const vscode = acquireVsCodeApi();
  const log = document.getElementById("log");
  const input = document.getElementById("input");
  const sendBtn = document.getElementById("send");
  const stopBtn = document.getElementById("stop");
  const clearBtn = document.getElementById("clear");
  const statusEl = document.getElementById("status");
  const hintEl = document.getElementById("mode-hint");
  const modeButtons = document.querySelectorAll(".mode-btn");

  function setRunning(running) {
    sendBtn.disabled = running;
    stopBtn.disabled = !running;
  }

  function setModeUi(mode) {
    modeButtons.forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-mode") === mode);
    });
    if (hintEl) {
      hintEl.textContent =
        mode === "solo"
          ? "SOLO: agent plans and executes the full task."
          : mode === "ask"
            ? "ASK: answers only — no file edits or terminal."
            : "IDE: you drive — agent helps on request.";
    }
    if (sendBtn) {
      sendBtn.textContent =
        mode === "solo" ? "Run SOLO" : mode === "ask" ? "Ask" : "Run Agent";
    }
  }

  modeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.getAttribute("data-mode");
      vscode.postMessage({ type: "set_mode", mode });
    });
  });

  function append(role, text) {
    const div = document.createElement("div");
    div.className = "msg " + role;
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }

  function appendPatch(msg) {
    const card = document.createElement("div");
    card.className = "msg patch";
    card.dataset.id = msg.id;

    const title = document.createElement("div");
    title.className = "patch-title";
    title.textContent =
      (msg.created ? "New file: " : "Edit: ") + (msg.path || "file");

    const preview = document.createElement("pre");
    preview.className = "patch-preview";
    preview.textContent = msg.preview || "";

    const actions = document.createElement("div");
    actions.className = "patch-actions";

    const accept = document.createElement("button");
    accept.textContent = "Accept";
    accept.addEventListener("click", () => {
      vscode.postMessage({ type: "accept", id: msg.id });
    });

    const reject = document.createElement("button");
    reject.className = "secondary";
    reject.textContent = "Reject";
    reject.addEventListener("click", () => {
      vscode.postMessage({ type: "reject", id: msg.id });
    });

    const diff = document.createElement("button");
    diff.className = "secondary";
    diff.textContent = "Diff";
    diff.addEventListener("click", () => {
      vscode.postMessage({ type: "diff", id: msg.id });
    });

    actions.appendChild(accept);
    actions.appendChild(reject);
    actions.appendChild(diff);

    const status = document.createElement("div");
    status.className = "patch-status";
    status.textContent = "Pending review (already applied — Reject restores)";

    card.appendChild(title);
    card.appendChild(preview);
    card.appendChild(actions);
    card.appendChild(status);
    log.appendChild(card);
    log.scrollTop = log.scrollHeight;
  }

  function updatePatchStatus(msg) {
    const card = log.querySelector('.patch[data-id="' + msg.id + '"]');
    if (!card) return;
    const status = card.querySelector(".patch-status");
    if (status) status.textContent = msg.text || msg.status || "";
    card.classList.add(msg.status === "rejected" ? "rejected" : "accepted");
    card.querySelectorAll("button").forEach((b) => {
      b.disabled = true;
    });
  }

  sendBtn.addEventListener("click", () => {
    const text = (input.value || "").trim();
    if (!text) return;
    append("user", text);
    input.value = "";
    setRunning(true);
    statusEl.textContent = "Running…";
    vscode.postMessage({ type: "send", text });
  });

  stopBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "stop" });
    statusEl.textContent = "Stopping…";
  });

  clearBtn.addEventListener("click", () => {
    log.innerHTML = "";
    vscode.postMessage({ type: "clear" });
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendBtn.click();
    }
  });

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || !msg.type) return;
    if (msg.type === "mode") {
      setModeUi(msg.mode || "ide");
    } else if (msg.type === "running") {
      setRunning(Boolean(msg.running));
    } else if (msg.type === "status") {
      statusEl.textContent = msg.text || "";
    } else if (msg.type === "assistant") {
      append("assistant", msg.text || "");
    } else if (msg.type === "tool") {
      append("tool", msg.text || "");
    } else if (msg.type === "patch") {
      appendPatch(msg);
    } else if (msg.type === "patch_status") {
      updatePatchStatus(msg);
    } else if (msg.type === "terminal") {
      const div = append("tool", msg.text || "");
      const btn = document.createElement("button");
      btn.className = "secondary mini";
      btn.textContent = "Run in VS Code terminal";
      btn.addEventListener("click", () => {
        vscode.postMessage({ type: "run_in_terminal", command: msg.command });
      });
      div.appendChild(document.createElement("br"));
      div.appendChild(btn);
    } else if (msg.type === "error") {
      append("error", msg.text || "Error");
      setRunning(false);
    } else if (msg.type === "done") {
      statusEl.textContent = msg.text || "Ready";
      setRunning(false);
    }
  });

  statusEl.textContent = "Ready";
  vscode.postMessage({ type: "ready" });
})();
