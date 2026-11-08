import { Router } from "express";
import { store } from "./store.js";
import { optionalAuth, type AuthedRequest } from "./auth.js";

export const historyRouter = Router();

historyRouter.get("/", optionalAuth, (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: "sign in to load history", threads: [] });
    return;
  }
  const projectKey = typeof req.query.projectKey === "string" ? req.query.projectKey : undefined;
  const threads = store.listHistory(req.user.id, projectKey).map((t) => ({
    id: t.id,
    title: t.title,
    projectKey: t.projectKey,
    updatedAt: t.updatedAt,
    preview: t.messages.find((m) => m.role === "user")?.content?.slice(0, 80) || "",
    messageCount: t.messages.length,
  }));
  res.json({ threads });
});

historyRouter.get("/:id", optionalAuth, (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: "sign in to load history" });
    return;
  }
  const thread = store.getThread(req.user.id, req.params.id);
  if (!thread) {
    res.status(404).json({ error: "thread not found" });
    return;
  }
  res.json({ thread });
});

historyRouter.post("/", optionalAuth, (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: "sign in to save history" });
    return;
  }
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const normalized = messages.map((m: { role?: string; content?: string; at?: string }) => ({
    role: String(m.role || "user"),
    content: String(m.content || ""),
    at: m.at || new Date().toISOString(),
  }));

  // Full thread replace (preferred for web chat)
  if (req.body?.replace === true || req.body?.threadId || !req.body?.append) {
    const thread = store.saveThread(req.user.id, {
      id: typeof req.body?.threadId === "string" ? req.body.threadId : undefined,
      title: typeof req.body?.title === "string" ? req.body.title : undefined,
      projectKey: typeof req.body?.projectKey === "string" ? req.body.projectKey : undefined,
      messages: normalized,
    });
    res.json({ thread });
    return;
  }

  // Legacy append-by-projectKey
  const projectKey = String(req.body?.projectKey || "default");
  const title = String(req.body?.title || "Chat");
  const thread = store.appendHistory(req.user.id, projectKey, title, normalized);
  res.json({ thread });
});

historyRouter.delete("/:id", optionalAuth, (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: "sign in required" });
    return;
  }
  const ok = store.deleteThread(req.user.id, req.params.id);
  res.status(ok ? 200 : 404).json({ ok });
});
