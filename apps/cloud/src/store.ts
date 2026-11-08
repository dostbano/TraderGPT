import fs from "node:fs";
import path from "node:path";
import { cloudConfig } from "./config.js";

export interface User {
  id: string;
  email: string;
  name: string;
  provider: "github" | "google" | "dev" | "anon";
  plan: "free" | "pro";
  createdAt: string;
}

export interface Session {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

export interface HistoryMessage {
  role: string;
  content: string;
  at: string;
}

export interface HistoryThread {
  id: string;
  userId: string;
  projectKey: string;
  title: string;
  messages: HistoryMessage[];
  updatedAt: string;
}

export interface UsageDay {
  userId: string;
  day: string;
  runs: number;
}

interface DbShape {
  users: User[];
  sessions: Session[];
  threads: HistoryThread[];
  usage: UsageDay[];
}

function emptyDb(): DbShape {
  return { users: [], sessions: [], threads: [], usage: [] };
}

export class Store {
  private data: DbShape = emptyDb();

  constructor(private readonly filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (fs.existsSync(filePath)) {
      try {
        this.data = JSON.parse(fs.readFileSync(filePath, "utf8")) as DbShape;
      } catch {
        this.data = emptyDb();
      }
    } else {
      this.save();
    }
  }

  private save(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf8");
  }

  listUsers(): User[] {
    return this.data.users;
  }

  upsertUser(u: Omit<User, "createdAt" | "plan"> & { plan?: User["plan"] }): User {
    let user = this.data.users.find((x) => x.id === u.id);
    if (!user) {
      user = {
        id: u.id,
        email: u.email,
        name: u.name,
        provider: u.provider,
        plan: u.plan || "free",
        createdAt: new Date().toISOString(),
      };
      this.data.users.push(user);
    } else {
      user.email = u.email;
      user.name = u.name;
    }
    this.save();
    return user;
  }

  getUser(id: string): User | undefined {
    return this.data.users.find((u) => u.id === id);
  }

  setPlan(userId: string, plan: User["plan"]): void {
    const u = this.getUser(userId);
    if (u) {
      u.plan = plan;
      this.save();
    }
  }

  createSession(userId: string): Session {
    const token = `stk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
    const session: Session = {
      token,
      userId,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 864e5).toISOString(),
    };
    this.data.sessions.push(session);
    this.save();
    return session;
  }

  sessionUser(token: string | undefined): User | undefined {
    if (!token) return undefined;
    const raw = token.replace(/^Bearer\s+/i, "");
    const s = this.data.sessions.find((x) => x.token === raw);
    if (!s) return undefined;
    if (new Date(s.expiresAt).getTime() < Date.now()) return undefined;
    return this.getUser(s.userId);
  }

  appendHistory(
    userId: string,
    projectKey: string,
    title: string,
    messages: HistoryMessage[],
  ): HistoryThread {
    let thread = this.data.threads.find(
      (t) => t.userId === userId && t.projectKey === projectKey,
    );
    if (!thread) {
      thread = {
        id: `th_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        userId,
        projectKey,
        title: title.slice(0, 120) || "Chat",
        messages: [],
        updatedAt: new Date().toISOString(),
      };
      this.data.threads.push(thread);
    }
    thread.messages.push(...messages);
    thread.updatedAt = new Date().toISOString();
    if (!thread.title || thread.title === "Chat") {
      thread.title = title.slice(0, 120) || "Chat";
    }
    this.save();
    return thread;
  }

  /** Create or fully replace a chat thread (ChatGPT-style per-conversation history). */
  saveThread(
    userId: string,
    opts: {
      id?: string;
      title?: string;
      projectKey?: string;
      messages: HistoryMessage[];
    },
  ): HistoryThread {
    let thread = opts.id
      ? this.data.threads.find((t) => t.id === opts.id && t.userId === userId)
      : undefined;
    if (!thread) {
      thread = {
        id: opts.id || `th_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        userId,
        projectKey: opts.projectKey || `chat_${Date.now().toString(36)}`,
        title: (opts.title || "New chat").slice(0, 120),
        messages: [],
        updatedAt: new Date().toISOString(),
      };
      this.data.threads.push(thread);
    }
    thread.messages = opts.messages;
    thread.updatedAt = new Date().toISOString();
    if (opts.title) thread.title = opts.title.slice(0, 120);
    else if (thread.title === "New chat" || thread.title === "Chat") {
      const firstUser = opts.messages.find((m) => m.role === "user");
      if (firstUser?.content) thread.title = firstUser.content.slice(0, 60);
    }
    this.save();
    return thread;
  }

  getThread(userId: string, threadId: string): HistoryThread | undefined {
    return this.data.threads.find((t) => t.id === threadId && t.userId === userId);
  }

  deleteThread(userId: string, threadId: string): boolean {
    const before = this.data.threads.length;
    this.data.threads = this.data.threads.filter(
      (t) => !(t.id === threadId && t.userId === userId),
    );
    if (this.data.threads.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  listHistory(userId: string, projectKey?: string): HistoryThread[] {
    return this.data.threads
      .filter((t) => t.userId === userId && (!projectKey || t.projectKey === projectKey))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  bumpUsage(userId: string): number {
    const day = new Date().toISOString().slice(0, 10);
    let row = this.data.usage.find((u) => u.userId === userId && u.day === day);
    if (!row) {
      row = { userId, day, runs: 0 };
      this.data.usage.push(row);
    }
    row.runs += 1;
    this.save();
    return row.runs;
  }

  getUsage(userId: string): number {
    const day = new Date().toISOString().slice(0, 10);
    return this.data.usage.find((u) => u.userId === userId && u.day === day)?.runs ?? 0;
  }

  usageSummary(): Array<{ userId: string; email: string; plan: string; today: number }> {
    const day = new Date().toISOString().slice(0, 10);
    return this.data.users.map((u) => ({
      userId: u.id,
      email: u.email,
      plan: u.plan,
      today: this.data.usage.find((x) => x.userId === u.id && x.day === day)?.runs ?? 0,
    }));
  }
}

export const store = new Store(cloudConfig.dbPath);
