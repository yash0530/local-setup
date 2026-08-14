#!/usr/bin/env bash
# freebuff-run.sh — Claude Code runner wrapper for Freebuff CLI
# Subcommands: check | ask | delegate | research | help

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRIDGE_SCRIPT="$HOME/.local/bin/freebuff-bridge"
if [ ! -f "$BRIDGE_SCRIPT" ]; then
  BRIDGE_SCRIPT="$SCRIPT_DIR/../../../../scripts/freebuff_bridge.py"
fi
if [ ! -f "$BRIDGE_SCRIPT" ]; then
  BRIDGE_SCRIPT="$HOME/.gemini/config/skills/freebuff/scripts/freebuff_bridge.py"
fi

cmd_check() {
  if ! command -v freebuff >/dev/null 2>&1; then
    cat <<JSON
{ "installed": false, "path": "", "error": "freebuff binary not found; install with: npm install -g freebuff" }
JSON
    return 0
  fi
  cat <<JSON
{ "installed": true, "path": "$(command -v freebuff)", "version": "$(freebuff -v 2>/dev/null || echo '0.0.149')" }
JSON
}

cmd_ask() {
  local prompt="$1"
  local cwd="${2:-$(pwd)}"
  local timeout="${3:-120}"

  if [ ! -f "$BRIDGE_SCRIPT" ]; then
    echo "❌ Error: freebuff-bridge script not found at $BRIDGE_SCRIPT" >&2
    exit 1
  fi

  python3 "$BRIDGE_SCRIPT" -p "$prompt" --cwd "$cwd" --timeout "$timeout"
}

cmd_help() {
  cat <<'EOF'
Freebuff Claude Plugin Commands:
  /freebuff:ask <prompt>       - Run a one-shot query or research question via Freebuff
  /freebuff:delegate <prompt>  - Delegate a coding/scaffolding task to Freebuff
  /freebuff:research <topic>   - Perform deep web-augmented research using Freebuff (DeepSeek V4 Pro)
  /freebuff:help               - Show this help message
EOF
}

subcmd="${1:-help}"
shift || true

case "$subcmd" in
  check)
    cmd_check "$@"
    ;;
  ask|delegate|research)
    cmd_ask "$@"
    ;;
  help|--help|-h)
    cmd_help
    ;;
  *)
    cmd_ask "$subcmd" "$@"
    ;;
esac
