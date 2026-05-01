#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run.sh — Local development launcher for APRS Dashboard
# Usage: ./run.sh [--dev]
#   --dev   Use nodemon for auto-restart on file changes (default if available)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()  { echo -e "${CYAN}[info]${RESET}  $*"; }
ok()    { echo -e "${GREEN}[ok]${RESET}    $*"; }
warn()  { echo -e "${YELLOW}[warn]${RESET}  $*"; }
fatal() { echo -e "${RED}[fatal]${RESET} $*" >&2; exit 1; }

echo -e "\n${BOLD}📡  APRS Dashboard — Local Launcher${RESET}\n"

# ── Check Node.js ─────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  fatal "Node.js is not installed. Install it from https://nodejs.org (>=18 required)."
fi

NODE_VER=$(node -e "process.stdout.write(process.versions.node)")
info "Node.js version: ${NODE_VER}"

MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
if [[ "$MAJOR" -lt 18 ]]; then
  fatal "Node.js 18 or later is required (found ${NODE_VER})."
fi

# ── Check / create .env ───────────────────────────────────────────────────────
if [[ ! -f ".env" ]]; then
  if [[ -f ".env.example" ]]; then
    warn ".env not found — copying from .env.example"
    cp .env.example .env
    echo -e "\n${YELLOW}  ⚠  Please edit .env and set at minimum:${RESET}"
    echo -e "     MY_CALLSIGN   — your callsign with SSID (e.g. W1AW-9)"
    echo -e "     DIREWOLF_HOST — hostname/IP of your Direwolf instance\n"
    read -rp "  Press Enter to continue after editing .env, or Ctrl-C to abort… "
  else
    fatal ".env and .env.example are both missing."
  fi
fi

# ── Validate required env vars ────────────────────────────────────────────────
# bash `source` chokes on chars like > in values, so parse manually
while IFS='=' read -r key value; do
  [[ -z "$key" || "$key" =~ ^[[:space:]]*# ]] && continue
  key="${key// /}"
  export "$key=$value"
done < .env

if [[ -z "${MY_CALLSIGN:-}" ]]; then
  fatal "MY_CALLSIGN is not set in .env"
fi
if [[ -z "${DIREWOLF_HOST:-}" ]]; then
  fatal "DIREWOLF_HOST is not set in .env"
fi

ok "Callsign:      ${MY_CALLSIGN}"
ok "Direwolf host: ${DIREWOLF_HOST}:${DIREWOLF_KISS_PORT:-8001}"
ok "Web port:      ${WEB_PORT:-3000}"

# ── Install dependencies if needed ───────────────────────────────────────────
if [[ ! -d "node_modules" ]]; then
  info "node_modules not found — running npm install…"
  npm install
  ok "Dependencies installed."
else
  info "node_modules present. (Run 'npm install' manually if package.json changed.)"
fi

# ── Decide dev vs. production mode ───────────────────────────────────────────
USE_DEV=false
if [[ "${1:-}" == "--dev" ]]; then
  USE_DEV=true
elif command -v npx &>/dev/null && npx --no nodemon --version &>/dev/null 2>&1; then
  USE_DEV=true
fi

echo ""
if $USE_DEV; then
  info "Starting in DEV mode (nodemon — auto-restart on changes)…"
  echo -e "  Dashboard → ${CYAN}http://localhost:${WEB_PORT:-3000}${RESET}\n"
  exec npx nodemon server/index.js
else
  info "Starting in PRODUCTION mode (node)…"
  echo -e "  Dashboard → ${CYAN}http://localhost:${WEB_PORT:-3000}${RESET}\n"
  exec node -r dotenv/config server/index.js
fi
