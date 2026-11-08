const $ = (s) => document.querySelector(s);
const tokenKey = "5tick_admin_token";

function token() {
  return localStorage.getItem(tokenKey) || $("#adminToken").value.trim();
}

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}), "x-admin-token": token() };
  if (opts.body && typeof opts.body === "object") {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(opts.body);
  }
  const r = await fetch(path, { ...opts, headers });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

function setPanel(name) {
  document.querySelectorAll(".nav").forEach((b) => b.classList.toggle("active", b.dataset.panel === name));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === `panel-${name}`));
  $("#title").textContent = name[0].toUpperCase() + name.slice(1);
}

async function refresh() {
  const health = await fetch("/health").then((r) => r.json());
  let overview = null;
  let users = null;
  try {
    overview = await api("/api/admin/overview");
    users = await api("/api/admin/users");
  } catch (e) {
    overview = { error: e.message };
  }

  const billing = await fetch("/api/billing/status").then((r) => r.json());
  const auth = health.auth || {};

  $("#panel-overview").innerHTML = `
    <div class="grid">
      <div class="stat"><div class="label">Users</div><div class="value">${overview?.users ?? "—"}</div></div>
      <div class="stat"><div class="label">Auth</div><div class="value ${auth.authEnabled ? "ok" : "warn"}">${auth.authEnabled ? "ON" : "OFF"}</div></div>
      <div class="stat"><div class="label">Billing</div><div class="value">${billing.billingEnabled ? "ON" : "OFF"}</div></div>
      <div class="stat"><div class="label">Agent</div><div class="value mono" style="font-size:0.85rem">${health.agentUrl || "—"}</div></div>
    </div>
    <div class="block">
      <h3>Public URL</h3>
      <p class="mono">${health.publicBaseUrl}</p>
    </div>
    ${overview?.error ? `<div class="block"><h3>Admin API</h3><p>${overview.error}</p></div>` : ""}
  `;

  const rows = (users?.usage || [])
    .map(
      (u) => `<tr>
        <td class="mono">${u.userId}</td>
        <td>${u.email}</td>
        <td><span class="pill">${u.plan}</span></td>
        <td class="mono">${u.today}</td>
        <td><button class="ghost set-plan" data-id="${u.userId}" data-plan="${u.plan === "pro" ? "free" : "pro"}">Set ${u.plan === "pro" ? "free" : "pro"}</button></td>
      </tr>`,
    )
    .join("");

  $("#panel-users").innerHTML = `
    <table>
      <thead><tr><th>ID</th><th>Email</th><th>Plan</th><th>Today</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5">No users yet</td></tr>`}</tbody>
    </table>
  `;
  document.querySelectorAll(".set-plan").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api("/api/billing/admin/set-plan", {
        method: "POST",
        body: { userId: btn.dataset.id, plan: btn.dataset.plan },
      });
      refresh();
    });
  });

  $("#panel-auth").innerHTML = `
    <div class="block">
      <h3>Status <span class="pill ${auth.authEnabled ? "on" : "off"}">${auth.authEnabled ? "enabled" : "disabled"}</span></h3>
      <p>${auth.message || ""}</p>
    </div>
    <div class="block">
      <h3>GitHub</h3>
      <p>Configured: <span class="pill ${auth.providers?.github?.configured ? "on" : "off"}">${auth.providers?.github?.configured ? "yes" : "no"}</span>
      · Live: <span class="pill ${auth.providers?.github?.enabled ? "on" : "off"}">${auth.providers?.github?.enabled ? "yes" : "waiting"}</span></p>
      <p>Set <code>FIVETICK_GITHUB_CLIENT_ID</code> / <code>FIVETICK_GITHUB_CLIENT_SECRET</code>, then <code>FIVETICK_AUTH_ENABLED=1</code>.</p>
    </div>
    <div class="block">
      <h3>Google</h3>
      <p>Configured: <span class="pill ${auth.providers?.google?.configured ? "on" : "off"}">${auth.providers?.google?.configured ? "yes" : "no"}</span>
      · Live: <span class="pill ${auth.providers?.google?.enabled ? "on" : "off"}">${auth.providers?.google?.enabled ? "yes" : "waiting"}</span></p>
      <p>Set <code>FIVETICK_GOOGLE_CLIENT_ID</code> / <code>FIVETICK_GOOGLE_CLIENT_SECRET</code>, then enable auth.</p>
    </div>
  `;

  $("#panel-billing").innerHTML = `
    <div class="block">
      <h3>Entitlement stub</h3>
      <p>Free daily runs: <strong class="mono">${billing.plans?.free?.dailyRuns ?? "—"}</strong></p>
      <p>Stripe: <span class="pill ${billing.stripeConfigured ? "on" : "off"}">${billing.stripeConfigured ? "configured" : "not set"}</span></p>
    </div>
  `;
}

$("#adminToken").value = localStorage.getItem(tokenKey) || "";
$("#saveToken").addEventListener("click", () => {
  localStorage.setItem(tokenKey, $("#adminToken").value.trim());
  refresh();
});
$("#refresh").addEventListener("click", () => refresh());
document.querySelectorAll(".nav").forEach((b) => b.addEventListener("click", () => { setPanel(b.dataset.panel); }));
refresh().catch((e) => {
  $("#panel-overview").innerHTML = `<div class="block"><h3>Error</h3><p>${e.message}</p></div>`;
});
