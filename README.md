# TraderGPT (5Tick)

AI coding / trading assistant stack:

- **Local agent** (`apps/agent`) — Ask / Agent modes, tools, web + optional MT5 Meta price/OHLC
- **Cloud control plane** (`apps/cloud`) — `ai.*` web chat, providers (Ollama / OpenAI / OpenRouter), history
- **VS Code / IDE extension** (`apps/extension`)

GitHub: [dostbano/TraderGPT](https://github.com/dostbano/TraderGPT)

---

## Move to a new server (example)

### 1) Clone

```powershell
git clone https://github.com/dostbano/TraderGPT.git
cd TraderGPT
```

### 2) Start (auto-install + build + run)

```powershell
npm start
```

This runs `scripts/start-server.ps1`, which:

1. Checks **Node.js 18+**
2. Creates **`.env`** from `.env.example` if missing (**does not overwrite** an existing `.env`)
3. Runs **`npm install`**
4. Builds shared / agent / cloud / extension
5. Starts **agent :3847** and **cloud :3850**

Linux/macOS:

```bash
chmod +x scripts/bootstrap-server.sh
npm run start:unix
```

### 3) Copy real API keys (do NOT use git)

On the **old** server, open `5Tick\.env`. On the **new** server, put the same values into `TraderGPT\.env` (SCP, RDP copy, or paste).

Never commit `.env`. Only `.env.example` is in the repo.

Important variables:

| Variable | Purpose |
|----------|---------|
| `FIVETICK_OPENAI_API_KEY` | OpenAI provider |
| `FIVETICK_OPENROUTER_API_KEY` | OpenRouter provider |
| `FIVETICK_API_BASE` / `FIVETICK_MODEL` | Default Ollama (or other) |
| `FIVETICK_PUBLIC_BASE_URL` | Public URL, e.g. `https://ai.11tick.com` |
| `FIVETICK_MT5_API_BASE` | Optional Meta/MT5 price+OHLC gateway |

After editing `.env`, restart agent/cloud (`npm start` again, or stop old processes and re-run).

### 4) DNS + Ollama + Caddy (you do this)

- Point your domain A-record to the **new server IP**
- Install Ollama and pull models if you use local providers
- Reverse-proxy HTTPS to cloud port **3850**, for example Caddy:

```caddyfile
ai.11tick.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:3850 {
    flush_interval -1
    transport http {
      read_timeout 10m
      write_timeout 10m
      response_header_timeout 10m
    }
  }
}
```

### 5) Verify

```text
http://127.0.0.1:3847/health
http://127.0.0.1:3850/health
https://YOUR-DOMAIN/
```

---

## Layout

```
TraderGPT/
  apps/agent       Agent server (tools + model)
  apps/cloud       Web UI + auth/history/billing stubs + provider switch
  apps/extension   VS Code extension
  packages/shared  Shared types / tools
  scripts/         Bootstrap, ensure-agent, ensure-cloud, IDE packaging
```

Huge local IDE binaries (`apps/ide/dist`, `VSCode-win32-x64`) are **not** in git; rebuild or copy Setup.exe separately if needed.

---

## Dev commands

```powershell
npm run bootstrap   # install + build only
npm run agent       # agent only
npm run cloud       # cloud only
npm run build
```
