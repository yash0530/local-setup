#!/usr/bin/env bash
# kiro-run.sh — Claude Code wrapper around Kiro CLI (`kiro-cli`).
# Subcommands: check | ask | review | help.

set -euo pipefail

find_kiro() {
  if command -v kiro-cli >/dev/null 2>&1; then
    command -v kiro-cli
    return 0
  fi
  for candidate in \
      "$HOME/.local/bin/kiro-cli" \
      "/usr/local/bin/kiro-cli" \
      "/opt/kiro/bin/kiro-cli"; do
    if [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

auth_status() {
  local path
  if ! path="$(find_kiro | head -n1)"; then
    echo "missing"
    return 0
  fi
  if "$path" whoami >/dev/null 2>&1; then
    echo "logged-in"
  else
    echo "missing"
  fi
}

j_esc() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}

cmd_check() {
  if ! path="$(find_kiro | head -n1)"; then
    cat <<JSON
{ "installed": false, "path": "", "version": "", "auth": "unknown",
  "error": "kiro-cli binary not found; please install it first" }
JSON
    return 0
  fi
  version="$("$path" --version 2>/dev/null | head -n1 || echo unknown)"
  auth="$(auth_status)"
  printf '{ "installed": true, "path": "%s", "version": "%s", "auth": "%s", "error": "" }\n' \
    "$(j_esc "$path")" "$(j_esc "$version")" "$(j_esc "$auth")"
}

require_ready() {
  if ! path="$(find_kiro)"; then
    echo "error: kiro-cli is not installed." >&2
    exit 127
  fi
  if [ "$(auth_status)" = "missing" ]; then
    echo "error: kiro-cli is not authenticated." >&2
    echo "       run \`kiro-cli login\` once interactively." >&2
    exit 1
  fi
  echo "$path"
}

print_model_table() {
  local fd="${1:-2}"
  {
    echo "Aliases (case-insensitive):"
    echo "  auto                          -> Auto-select model"
    echo "  opus, claude-opus             -> Claude Opus 4.8"
    echo "  sonnet, claude-sonnet         -> Claude Sonnet 4.6"
    echo "  haiku, claude-haiku           -> Claude Haiku 4.5"
    echo "  deepseek                      -> DeepSeek V3.2"
    echo "  minimax                       -> MiniMax M2.5"
    echo "  qwen                          -> Qwen3 Coder Next"
    echo
    echo "Canonical strings (accepted verbatim):"
    echo "  auto, claude-opus-4.8, claude-opus-4.7, claude-opus-4.6"
    echo "  claude-sonnet-4.6, claude-opus-4.5, claude-sonnet-4.5, claude-sonnet-4"
    echo "  claude-haiku-4.5, deepseek-3.2, minimax-m2.5, minimax-m2.1, glm-5, qwen3-coder-next"
  } >&"$fd"
}

resolve_model_alias() {
  local input="${1:-}"
  if [ -z "$input" ]; then
    echo "error: --model requires a non-empty value (e.g. --model sonnet)" >&2
    print_model_table 2
    exit 64
  fi
  case "$input" in
    "auto"|\
    "claude-opus-4.8"|\
    "claude-opus-4.7"|\
    "claude-opus-4.6"|\
    "claude-sonnet-4.6"|\
    "claude-opus-4.5"|\
    "claude-sonnet-4.5"|\
    "claude-sonnet-4"|\
    "claude-haiku-4.5"|\
    "deepseek-3.2"|\
    "minimax-m2.5"|\
    "minimax-m2.1"|\
    "glm-5"|\
    "qwen3-coder-next")
      printf '%s' "$input"
      return 0 ;;
  esac
  local lc; lc="$(printf '%s' "$input" | tr '[:upper:]' '[:lower:]')"
  case "$lc" in
    auto)                       printf '%s' "auto" ;;
    opus|claude-opus|opus-4.8)  printf '%s' "claude-opus-4.8" ;;
    opus-4.7)                   printf '%s' "claude-opus-4.7" ;;
    opus-4.6)                   printf '%s' "claude-opus-4.6" ;;
    sonnet|claude-sonnet|sonnet-4.6) printf '%s' "claude-sonnet-4.6" ;;
    haiku|claude-haiku)         printf '%s' "claude-haiku-4.5" ;;
    deepseek)                   printf '%s' "deepseek-3.2" ;;
    minimax)                    printf '%s' "minimax-m2.5" ;;
    qwen)                       printf '%s' "qwen3-coder-next" ;;
    *)
      echo "error: unknown model alias '$input'" >&2
      print_model_table 2
      exit 64 ;;
  esac
}

clean_output() {
  python3 -c '
import sys
import re
text = sys.stdin.read()

# Strip ANSI escapes
ansi_escape = re.compile(r"\x1b\[[0-9;]*[a-zA-Z]")
text_clean = ansi_escape.sub("", text)

lines = text_clean.splitlines()

first_non_empty_idx = -1
for i, line in enumerate(lines):
    if line.strip():
        first_non_empty_idx = i
        break

if first_non_empty_idx != -1:
    first_line = lines[first_non_empty_idx]
    if first_line.startswith("> "):
        lines[first_non_empty_idx] = first_line[2:]
    elif first_line.startswith(">"):
        lines[first_non_empty_idx] = first_line[1:]
    
    for i in range(len(lines) - 1, -1, -1):
        if "Credits:" in lines[i] and ("Time:" in lines[i] or "•" in lines[i]):
            lines[i] = ""
            break

cleaned = "\n".join(lines).strip()
print(cleaned)
'
}

cmd_ask() {
  local model_alias=""
  local effort=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --model)
        if [ $# -ge 2 ]; then
          model_alias="$2"; shift 2
        else
          shift
        fi ;;
      --model=*)
        model_alias="${1#--model=}"
        shift ;;
      --effort)
        if [ $# -ge 2 ]; then
          effort="$2"; shift 2
        else
          shift
        fi ;;
      --effort=*)
        effort="${1#--effort=}"
        shift ;;
      --)        shift; break ;;
      *)         break ;;
    esac
  done
  
  local prompt="${1:-}"
  shift || true
  if [ -z "$prompt" ]; then
    echo "error: ask requires a prompt argument" >&2
    exit 64
  fi
  local path
  path="$(require_ready)"
  
  local current_model="$model_alias"
  
  while true; do
    local run_args=()
    if [ -n "$current_model" ]; then
      local canonical
      canonical="$(resolve_model_alias "$current_model")"
      run_args+=("--model" "$canonical")
    fi
    if [ -n "$effort" ]; then
      run_args+=("--effort" "$effort")
    fi

    local response
    local rc=0
    local err_file; err_file=$(mktemp)
    
    response=$("$path" chat "$prompt" --no-interactive ${run_args[@]+"${run_args[@]}"} "$@" 2>"$err_file") || rc=$?
    local err_msg; err_msg=$(cat "$err_file")
    rm -f "$err_file"

    if [ "$rc" -ne 0 ] && { echo "$response" | grep -qE -i "rate_limit|rate limit|429|quota|exhausted|limit exceeded" || echo "$err_msg" | grep -qE -i "rate_limit|rate limit|429|quota|exhausted|limit exceeded"; }; then
      local lc; lc=$(echo "$current_model" | tr '[:upper:]' '[:lower:]')
      local next_model=""
      case "$lc" in
        *opus*)   next_model="sonnet" ;;
        "")       next_model="sonnet" ;;
      esac

      if [ -n "$next_model" ] && [ "$next_model" != "$current_model" ]; then
        echo "[wrapper] Rate limit hit on '${current_model:-default}'. Retrying with fallback '$next_model'..." >&2
        current_model="$next_model"
        continue
      fi
    fi

    if [ -n "$err_msg" ]; then
      echo "$err_msg" >&2
    fi
    printf '%s\n' "$response" | clean_output
    return "$rc"
  done
}

cmd_review() {
  local focus="${1:-Please review the following diff for correctness, edge cases, security issues, and style.}"
  local path
  path="$(require_ready)"
  local repo_dir="${CLAUDE_PROJECT_DIR:-$PWD}"
  local diff
  diff="$(git -C "$repo_dir" diff HEAD 2>/dev/null || true)"
  if [ -z "$diff" ]; then
    diff="$(git -C "$repo_dir" diff 2>/dev/null || true)"
  fi
  if [ -z "$diff" ]; then
    echo "error: no git diff found in $repo_dir. Stage or make changes first." >&2
    exit 1
  fi
  local full
  full=$(printf '%s\n\nDiff:\n```diff\n%s\n```\n' "$focus" "$diff")
  
  "$path" chat "$full" --no-interactive | clean_output
}

cmd_help() {
  cat <<'HELP'
/kiro:* commands (Claude Code plugin for the Kiro CLI)

Slash commands
  /kiro:setup                           Verify kiro install + auth.
  /kiro:ask [--model A] [--effort E] <prompt>
                                        One-shot prompt; returns kiro's response verbatim.
  /kiro:delegate [--background] [--model A] [--effort E] <task>
                                        Hand a task to the kiro:runner subagent.
  /kiro:research [--background] [--model A] [--effort E] <topic>
                                        Deep-research investigation via kiro:runner.
  /kiro:review [focus]                   Send current `git diff` to kiro for review.
  /kiro:help                            This help.

Model selection (--model)
HELP
  print_model_table 1
  cat <<'HELP'

Effort level (--effort)
  low, medium, high, xhigh, max (e.g. --effort max)

Underlying CLI
  Run `kiro-cli chat --help` for full options.
HELP
}

main() {
  case "${1:-}" in
    check)              cmd_check ;;
    ask)     shift;     cmd_ask "$@" ;;
    review)  shift;     cmd_review "$@" ;;
    help|-h|--help|"")  cmd_help ;;
    *)                  echo "error: unknown subcommand '$1'" >&2; cmd_help >&2; exit 64 ;;
  esac
}

if [ "${BASH_SOURCE[0]:-}" = "${0:-}" ]; then
  main "$@"
fi
