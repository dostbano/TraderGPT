import { Router } from "express";
import { cloudConfig } from "./config.js";
import { store, type User } from "./store.js";
import { optionalAuth, type AuthedRequest, requireAdmin } from "./auth.js";

export interface Entitlement {
  ok: boolean;
  plan: string;
  usedToday: number;
  limit: number | null;
  reason?: string;
}

export function checkEntitlement(user: User | undefined): Entitlement {
  if (!cloudConfig.billingEnabled) {
    return { ok: true, plan: "unlimited", usedToday: 0, limit: null };
  }
  // Anonymous / no auth: soft free bucket keyed as anon
  const plan = user?.plan || "free";
  const used = user ? store.getUsage(user.id) : 0;
  if (plan === "pro") {
    return { ok: true, plan, usedToday: used, limit: null };
  }
  const limit = cloudConfig.freeDailyRuns;
  if (used >= limit) {
    return {
      ok: false,
      plan,
      usedToday: used,
      limit,
      reason: `Free plan daily limit (${limit}) reached. Upgrade to Pro when billing is live.`,
    };
  }
  return { ok: true, plan, usedToday: used, limit };
}

export function recordRun(user: User | undefined): void {
  if (!cloudConfig.billingEnabled) return;
  if (user) store.bumpUsage(user.id);
}

export const billingRouter = Router();

billingRouter.get("/status", optionalAuth, (req: AuthedRequest, res) => {
  const ent = checkEntitlement(req.user);
  res.json({
    billingEnabled: cloudConfig.billingEnabled,
    stripeConfigured: Boolean(cloudConfig.stripeSecretKey),
    plans: {
      free: { dailyRuns: cloudConfig.freeDailyRuns },
      pro: { dailyRuns: null, note: "Unlimited when Stripe is wired" },
    },
    entitlement: ent,
    user: req.user
      ? { id: req.user.id, email: req.user.email, plan: req.user.plan }
      : null,
  });
});

billingRouter.post("/checkout-stub", optionalAuth, (req: AuthedRequest, res) => {
  if (!cloudConfig.stripeSecretKey) {
    res.status(501).json({
      error: "Stripe not configured",
      hint: "Set FIVETICK_STRIPE_SECRET_KEY to enable checkout. Stub keeps Pro upgrade path ready.",
    });
    return;
  }
  res.status(501).json({
    error: "Stripe Checkout stub — wire price IDs next",
    userId: req.user?.id,
  });
});

billingRouter.post("/webhook", (req, res) => {
  // Placeholder: verify stripe signature when secret set
  if (!cloudConfig.stripeWebhookSecret) {
    res.status(501).json({ error: "webhook not configured" });
    return;
  }
  res.json({ received: true, stub: true });
});

billingRouter.post("/admin/set-plan", requireAdmin, (req, res) => {
  const userId = String(req.body?.userId || "");
  const plan = req.body?.plan === "pro" ? "pro" : "free";
  if (!userId) {
    res.status(400).json({ error: "userId required" });
    return;
  }
  store.setPlan(userId, plan);
  res.json({ ok: true, userId, plan });
});
