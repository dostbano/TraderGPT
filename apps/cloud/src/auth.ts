import { Router, type Request, type Response, type NextFunction } from "express";
import { cloudConfig, oauthReady } from "./config.js";
import { store, type User } from "./store.js";

export type AuthedRequest = Request & { user?: User };

export function authStatus() {
  const ready = oauthReady();
  return {
    authEnabled: cloudConfig.authEnabled,
    providers: {
      github: {
        configured: ready.github,
        enabled: cloudConfig.authEnabled && ready.github,
      },
      google: {
        configured: ready.google,
        enabled: cloudConfig.authEnabled && ready.google,
      },
    },
    message: cloudConfig.authEnabled
      ? ready.github || ready.google
        ? "OAuth active for configured providers"
        : "AUTH_ENABLED=1 but no OAuth client IDs yet — set FIVETICK_GITHUB_* / FIVETICK_GOOGLE_*"
      : "Auth disabled until OAuth client IDs are ready. Set FIVETICK_AUTH_ENABLED=1 after configuring providers.",
  };
}

/** Optional auth: if token present, attach user; never require when auth disabled */
export function optionalAuth(req: AuthedRequest, _res: Response, next: NextFunction): void {
  const header = req.header("authorization") || req.header("x-5tick-token");
  req.user = store.sessionUser(header);
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const token = req.header("x-admin-token") || (req.query.token as string | undefined);
  if (token !== cloudConfig.adminToken) {
    res.status(401).json({ error: "admin token required" });
    return;
  }
  next();
}

export const authRouter = Router();

authRouter.get("/status", (_req, res) => {
  res.json(authStatus());
});

authRouter.get("/me", optionalAuth, (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: "not signed in", auth: authStatus() });
    return;
  }
  res.json({ user: req.user, auth: authStatus() });
});

/** Dev login — only when auth is off OR explicitly allowed for local testing */
authRouter.post("/dev-login", (req, res) => {
  if (cloudConfig.authEnabled) {
    res.status(403).json({
      error: "Dev login disabled while AUTH_ENABLED=1. Use GitHub/Google OAuth.",
      auth: authStatus(),
    });
    return;
  }
  const email = String(req.body?.email || "dev@5tick.local");
  const name = String(req.body?.name || "5Tick Dev");
  const user = store.upsertUser({
    id: `dev_${Buffer.from(email).toString("base64url").slice(0, 16)}`,
    email,
    name,
    provider: "dev",
  });
  const session = store.createSession(user.id);
  res.json({ token: session.token, user, auth: authStatus() });
});

/**
 * Anonymous browser session for chat history (ChatGPT-style) while OAuth is off.
 * Client stores deviceId in localStorage and reuses the same guest user.
 */
authRouter.post("/anon", (req, res) => {
  let deviceId = String(req.body?.deviceId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (deviceId.length < 8) {
    deviceId = `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
  deviceId = deviceId.slice(0, 64);
  const user = store.upsertUser({
    id: `anon_${deviceId}`,
    email: `${deviceId}@anon.5tick.local`,
    name: "Guest",
    provider: "anon",
  });
  const session = store.createSession(user.id);
  res.json({
    token: session.token,
    deviceId,
    user: { id: user.id, name: user.name },
    auth: authStatus(),
  });
});

authRouter.get("/oauth/:provider", (req, res) => {
  const provider = req.params.provider as "github" | "google";
  const ready = oauthReady();
  const configured = provider === "github" ? ready.github : ready.google;

  if (!cloudConfig.authEnabled || !configured) {
    res.status(501).json({
      error: "OAuth not active yet",
      provider,
      hint:
        "Wire is ready. Set FIVETICK_GITHUB_CLIENT_ID/SECRET and/or FIVETICK_GOOGLE_CLIENT_ID/SECRET, then FIVETICK_AUTH_ENABLED=1.",
      auth: authStatus(),
    });
    return;
  }

  // Real OAuth start — redirect URLs ready for when client IDs exist
  const redirectUri = `${cloudConfig.publicBaseUrl}/api/auth/oauth/${provider}/callback`;
  if (provider === "github") {
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", cloudConfig.githubClientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", "read:user user:email");
    url.searchParams.set("state", `gh_${Date.now()}`);
    res.redirect(url.toString());
    return;
  }

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", cloudConfig.googleClientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", `go_${Date.now()}`);
  res.redirect(url.toString());
});

authRouter.get("/oauth/:provider/callback", async (req, res) => {
  const provider = req.params.provider as "github" | "google";
  const ready = oauthReady();
  const configured = provider === "github" ? ready.github : ready.google;
  const code = String(req.query.code || "");

  if (!cloudConfig.authEnabled || !configured) {
    res.status(501).send("OAuth not configured. Enable after setting client IDs.");
    return;
  }
  if (!code) {
    res.status(400).send("Missing code");
    return;
  }

  try {
    const user =
      provider === "github"
        ? await exchangeGithub(code)
        : await exchangeGoogle(code);
    const session = store.createSession(user.id);
    // Hand token to IDE / admin via hash (SPA can read)
    res.redirect(
      `${cloudConfig.publicBaseUrl}/dev/?token=${encodeURIComponent(session.token)}`,
    );
  } catch (e) {
    res.status(500).send(`OAuth failed: ${e instanceof Error ? e.message : String(e)}`);
  }
});

async function exchangeGithub(code: string): Promise<User> {
  const redirectUri = `${cloudConfig.publicBaseUrl}/api/auth/oauth/github/callback`;
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: cloudConfig.githubClientId,
      client_secret: cloudConfig.githubClientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!tokenJson.access_token) throw new Error(tokenJson.error || "no github token");

  const profileRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "5Tick",
    },
  });
  const profile = (await profileRes.json()) as {
    id: number;
    login: string;
    name?: string;
    email?: string;
  };
  let email = profile.email || "";
  if (!email) {
    const emailsRes = await fetch("https://api.github.com/user/emails", {
      headers: {
        Authorization: `Bearer ${tokenJson.access_token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "5Tick",
      },
    });
    const emails = (await emailsRes.json()) as Array<{ email: string; primary: boolean }>;
    email = emails.find((e) => e.primary)?.email || emails[0]?.email || `${profile.login}@users.noreply.github.com`;
  }
  return store.upsertUser({
    id: `gh_${profile.id}`,
    email,
    name: profile.name || profile.login,
    provider: "github",
  });
}

async function exchangeGoogle(code: string): Promise<User> {
  const redirectUri = `${cloudConfig.publicBaseUrl}/api/auth/oauth/google/callback`;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cloudConfig.googleClientId,
      client_secret: cloudConfig.googleClientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!tokenJson.access_token) throw new Error(tokenJson.error || "no google token");

  const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  const profile = (await profileRes.json()) as {
    id: string;
    email: string;
    name?: string;
  };
  return store.upsertUser({
    id: `go_${profile.id}`,
    email: profile.email,
    name: profile.name || profile.email,
    provider: "google",
  });
}
