(() => {
  const THEME_KEY = "5tick_web_theme";
  const MODE_KEY = "5tick_web_mode";
  const PROVIDER_KEY = "5tick_web_provider";
  const TOKEN_KEY = "5tick_web_token";
  const DEVICE_KEY = "5tick_web_device";

  const thread = document.getElementById("thread");
  const empty = document.getElementById("empty");
  const input = document.getElementById("input");
  const sendBtn = document.getElementById("sendBtn");
  const stopBtn = document.getElementById("stopBtn");
  const statusEl = document.getElementById("status");
  const modeHint = document.getElementById("modeHint");
  const themeSelect = document.getElementById("themeSelect");
  const providerSelect = document.getElementById("providerSelect");
  const modelMeta = document.getElementById("modelMeta");
  const chatList = document.getElementById("chatList");

  /** @type {"ask"|"ide"} */
  let mode = localStorage.getItem(MODE_KEY) === "ide" ? "ide" : "ask";
  /** @type {string} */
  let providerId = localStorage.getItem(PROVIDER_KEY) || "ollama";
  /** @type {{ role: string, content: string }[]} */
  let history = [];
  /** @type {string|null} */
  let threadId = null;
  /** @type {string} */
  let authToken = localStorage.getItem(TOKEN_KEY) || "";
  /** @type {AbortController|null} */
  let abort = null;
  let running = false;

  const hints = {
    ask: "Ask can web_search / web_fetch live data. No file writes or terminal.",
    ide: "Agent: workspace tools + web. Safe mode asks before write/run.",
  };

  function authHeaders(extra = {}) {
    const h = { ...extra };
    if (authToken) h.Authorization = `Bearer ${authToken}`;
    return h;
  }

  function applyTheme(theme) {
    const t = theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", t);
    themeSelect.value = t;
    localStorage.setItem(THEME_KEY, t);
  }

  function setMode(next) {
    mode = next === "ide" ? "ide" : "ask";
    localStorage.setItem(MODE_KEY, mode);
    document.querySelectorAll(".mode").forEach((btn) => {
      const on = btn.dataset.mode === mode;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    modeHint.textContent = hints[mode];
  }

  function setStatus(text) {
    statusEl.textContent = text || "";
  }

  function hideEmpty() {
    if (empty) empty.hidden = true;
  }

  function clearThreadUi() {
    history = [];
    threadId = null;
    thread.querySelectorAll(".msg").forEach((n) => n.remove());
    if (empty) {
      empty.hidden = false;
      thread.appendChild(empty);
    }
    setStatus("");
    document.querySelectorAll(".chat-item").forEach((el) => el.classList.remove("active"));
  }

  function addMsg(role, text, opts = {}) {
    hideEmpty();
    const el = document.createElement("div");
    el.className = `msg ${role}`;
    if (opts.id) el.id = opts.id;
    if (opts.thinking) el.classList.add("thinking");
    const who =
      role === "user" ? "You" : role === "assistant" ? "5Tick" : role === "tool" ? "Tool" : "System";
    el.innerHTML = `<div class="who">${who}</div><div class="body"></div>`;
    el.querySelector(".body").textContent = text || "";
    if (opts.extra) el.appendChild(opts.extra);
    thread.appendChild(el);
    thread.scrollTop = thread.scrollHeight;
    return el;
  }

  function updateAssistant(el, text) {
    el.classList.remove("thinking");
    el.querySelector(".body").textContent = text;
    thread.scrollTop = thread.scrollHeight;
  }

  function showSystemError(message, assistantEl) {
    const msg = String(message || "Unknown error");
    addMsg("system", msg);
    if (assistantEl && !assistantEl.querySelector(".body").textContent) {
      assistantEl.remove();
    }
    setStatus("Error");
  }

  function autosize() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
  }

  async function ensureSession() {
    if (authToken) {
      try {
        const r = await fetch("/api/auth/me", { headers: authHeaders() });
        if (r.ok) return;
      } catch {
        /* re-anon */
      }
    }
    let deviceId = localStorage.getItem(DEVICE_KEY) || "";
    const r = await fetch("/api/auth/anon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "anon login failed");
    authToken = j.token;
    localStorage.setItem(TOKEN_KEY, authToken);
    if (j.deviceId) localStorage.setItem(DEVICE_KEY, j.deviceId);
  }

  async function persistChat() {
    if (!history.length) return;
    try {
      await ensureSession();
      const title =
        history.find((m) => m.role === "user")?.content?.slice(0, 60) || "New chat";
      const r = await fetch("/api/history", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          threadId: threadId || undefined,
          title,
          projectKey: threadId ? undefined : `web_${Date.now().toString(36)}`,
          replace: true,
          messages: history.map((m) => ({
            role: m.role,
            content: m.content,
            at: new Date().toISOString(),
          })),
        }),
      });
      const j = await r.json();
      if (r.ok && j.thread?.id) {
        threadId = j.thread.id;
        await refreshChatList();
      }
    } catch (e) {
      console.warn("persistChat", e);
    }
  }

  async function refreshChatList() {
    try {
      await ensureSession();
      const r = await fetch("/api/history", { headers: authHeaders() });
      const j = await r.json();
      const threads = j.threads || [];
      chatList.innerHTML = "";
      if (!threads.length) {
        chatList.innerHTML = `<div class="chat-list-empty">No chats yet</div>`;
        return;
      }
      for (const t of threads) {
        const row = document.createElement("div");
        row.className = "chat-item" + (t.id === threadId ? " active" : "");
        row.dataset.id = t.id;

        const main = document.createElement("button");
        main.type = "button";
        main.className = "chat-item-main";
        main.textContent = t.title || t.preview || "Chat";
        main.title = t.title || "";
        main.addEventListener("click", () => loadChat(t.id));

        const del = document.createElement("button");
        del.type = "button";
        del.className = "chat-del";
        del.title = "Delete";
        del.textContent = "×";
        del.addEventListener("click", async (e) => {
          e.stopPropagation();
          await fetch(`/api/history/${t.id}`, {
            method: "DELETE",
            headers: authHeaders(),
          });
          if (threadId === t.id) clearThreadUi();
          await refreshChatList();
        });

        row.append(main, del);
        chatList.appendChild(row);
      }
    } catch (e) {
      chatList.innerHTML = `<div class="chat-list-empty">History unavailable</div>`;
    }
  }

  async function loadChat(id) {
    if (running) abort?.abort();
    try {
      await ensureSession();
      const r = await fetch(`/api/history/${id}`, { headers: authHeaders() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "load failed");
      const th = j.thread;
      threadId = th.id;
      history = (th.messages || [])
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role, content: m.content }));
      thread.querySelectorAll(".msg").forEach((n) => n.remove());
      if (empty) empty.hidden = true;
      for (const m of history) {
        addMsg(m.role === "user" ? "user" : "assistant", m.content);
      }
      if (!history.length && empty) {
        empty.hidden = false;
        thread.appendChild(empty);
      }
      setStatus("Loaded chat");
      await refreshChatList();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  }

  async function resolveConfirm(requestId, toolCallId, approved) {
    await fetch("/v1/confirm", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ requestId, toolCallId, approved }),
    });
  }

  function showConfirm(data) {
    const name = String(data.name || "tool");
    const id = String(data.id || "");
    const requestId = String(data.requestId || "");
    const args = data.arguments || {};
    const detail =
      name === "write_file"
        ? `Write ${args.path || "?"}`
        : name === "run_terminal"
          ? `Run: ${args.command || "?"}`
          : name;

    const wrap = document.createElement("div");
    wrap.className = "confirm";
    const allow = document.createElement("button");
    allow.type = "button";
    allow.className = "allow";
    allow.textContent = "Allow";
    const deny = document.createElement("button");
    deny.type = "button";
    deny.className = "deny";
    deny.textContent = "Deny";
    const lock = () => {
      allow.disabled = true;
      deny.disabled = true;
    };
    allow.onclick = async () => {
      lock();
      await resolveConfirm(requestId, id, true);
      setStatus(`Allowed ${name}`);
    };
    deny.onclick = async () => {
      lock();
      await resolveConfirm(requestId, id, false);
      setStatus(`Denied ${name}`);
    };
    addMsg("system", `Safe mode: allow ${detail}?`, { extra: wrap });
    wrap.append(allow, deny);
  }

  async function send() {
    const text = input.value.trim();
    if (!text || running) return;

    history.push({ role: "user", content: text });
    addMsg("user", text);
    input.value = "";
    autosize();
    await persistChat();

    const assistantEl = addMsg("assistant", "", { thinking: true });
    let assistantText = "";
    let sawError = false;
    const requestId = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    abort = new AbortController();
    running = true;
    sendBtn.disabled = true;
    stopBtn.hidden = false;
    setStatus(mode === "ask" ? "Ask… contacting model" : "Agent running…");

    try {
      await ensureSession();
      const res = await fetch("/v1/agent", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        signal: abort.signal,
        body: JSON.stringify({
          mode,
          messages: history,
          requestId,
          safeMode: mode === "ide",
          maxSteps: mode === "ask" ? 5 : 16,
          projectKey: threadId || "web-chat",
          providerId,
        }),
      });

      if (!res.ok || !res.body) {
        const errText = await res.text();
        let detail = errText || `HTTP ${res.status}`;
        try {
          const j = JSON.parse(errText);
          detail = j.detail || j.error || detail;
          if (typeof detail === "object") detail = JSON.stringify(detail);
        } catch {
          /* keep */
        }
        throw new Error(detail);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          let event;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          const data = event.data || {};
          switch (event.type) {
            case "status":
              setStatus(
                `mode=${data.mode || mode} · ${data.phase || "run"} · ${data.model || ""}`.replace(
                  /\s+/g,
                  " ",
                ).trim(),
              );
              break;
            case "assistant_delta":
              assistantText = String(data.text ?? assistantText);
              updateAssistant(assistantEl, assistantText);
              break;
            case "tool_start":
              addMsg(
                "tool",
                `→ ${data.name || "tool"} ${JSON.stringify(data.arguments || {}).slice(0, 200)}`,
              );
              break;
            case "tool_result":
              addMsg(
                "tool",
                `← ${data.name || "tool"}: ${String(data.result ?? data.preview ?? "").slice(0, 400)}`,
              );
              break;
            case "confirm_required":
              showConfirm(data);
              break;
            case "final":
              if (data.text) {
                assistantText = String(data.text);
                updateAssistant(assistantEl, assistantText);
              }
              break;
            case "error":
              sawError = true;
              showSystemError(data.message || "Agent error", assistantEl);
              break;
            case "cancelled":
              setStatus("Cancelled");
              break;
            default:
              break;
          }
        }
      }

      if (!sawError && assistantText) {
        history.push({ role: "assistant", content: assistantText });
        setStatus("Ready");
      } else if (
        !sawError &&
        assistantEl.isConnected &&
        !assistantEl.querySelector(".body").textContent
      ) {
        showSystemError("No response from model (empty reply).", assistantEl);
      } else if (!sawError) {
        setStatus("Ready");
      }
      await persistChat();
    } catch (err) {
      if (err?.name === "AbortError" || abort?.signal.aborted) {
        if (!assistantText) updateAssistant(assistantEl, "Stopped.");
        setStatus("Stopped");
      } else {
        showSystemError(err instanceof Error ? err.message : String(err), assistantEl);
      }
      await persistChat();
    } finally {
      running = false;
      sendBtn.disabled = false;
      stopBtn.hidden = true;
      abort = null;
    }
  }

  applyTheme(localStorage.getItem(THEME_KEY) || "dark");
  themeSelect.addEventListener("change", () => applyTheme(themeSelect.value));
  setMode(mode);
  document.querySelectorAll(".mode").forEach((btn) => {
    btn.addEventListener("click", () => setMode(btn.dataset.mode));
  });

  document.getElementById("newChat").addEventListener("click", () => {
    if (running) abort?.abort();
    clearThreadUi();
    refreshChatList();
  });

  sendBtn.addEventListener("click", () => send());
  stopBtn.addEventListener("click", () => abort?.abort());
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  async function loadProviders() {
    try {
      const j = await fetch("/api/providers").then((r) => r.json());
      const providers = j.providers || [];
      providerSelect.innerHTML = "";
      for (const p of providers) {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.configured
          ? `${p.label} · ${p.model}`
          : `${p.label} (set API key)`;
        opt.disabled = !p.configured;
        if (p.active) providerId = p.id;
        providerSelect.appendChild(opt);
      }
      const saved = localStorage.getItem(PROVIDER_KEY);
      if (saved && [...providerSelect.options].some((o) => o.value === saved && !o.disabled)) {
        providerId = saved;
      }
      providerSelect.value = providerId;
      const active = providers.find((p) => p.id === providerId);
      modelMeta.textContent = active
        ? `${active.label}\n${active.model}`
        : "No provider";
    } catch {
      modelMeta.textContent = "Providers unavailable";
    }
  }

  providerSelect.addEventListener("change", async () => {
    const id = providerSelect.value;
    try {
      const r = await fetch("/api/providers/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.statusText);
      providerId = id;
      localStorage.setItem(PROVIDER_KEY, id);
      const active = (j.providers || []).find((p) => p.id === id);
      modelMeta.textContent = active ? `${active.label}\n${active.model}` : id;
      setStatus(`Provider: ${active?.label || id}`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
      await loadProviders();
    }
  });

  ensureSession()
    .then(() => refreshChatList())
    .catch(() => {
      chatList.innerHTML = `<div class="chat-list-empty">History offline</div>`;
    });
  loadProviders();
})();
