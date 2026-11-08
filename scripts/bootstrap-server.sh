#!/usr/bin/env bash
# TraderGPT / 5Tick — first-run bootstrap for Linux/macOS.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

need_node() {
  if ! command -v node >/dev/null 2>&1; then
    echo "Node.js is not installed. Install Node 18+ then re-run npm start"
    exit 1
  fi
  major="$(node -v | sed 's/^v//' | cut -d. -f1)"
  if [ "$major" -lt 18 ]; then
    echo "Node.js $(node -v) found; need 18+"
    exit 1
  fi
  echo "[TraderGPT] Node $(node -v) OK"
}

ensure_env() {
  if [ ! -f .env ]; then
    cp .env.example .env
    echo "[TraderGPT] Created .env from .env.example — EDIT IT with your API keys"
  else
    echo "[TraderGPT] .env already present"
  fi
}

need_node
ensure_env
echo "[TraderGPT] npm install..."
npm install
echo "[TraderGPT] build..."
npm run build

if [ "${1:-}" = "--start" ]; then
  echo "[TraderGPT] Starting agent..."
  npm run agent &
  sleep 2
  echo "[TraderGPT] Starting cloud..."
  npm run cloud &
  echo "[TraderGPT] Agent :3847  Cloud :3850"
  wait
else
  echo "[TraderGPT] Bootstrap complete. Run: npm start"
fi
