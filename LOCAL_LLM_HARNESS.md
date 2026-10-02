# Wiring local Qwen 3.8 into Claude Code

How to use the locally-served Qwen 3.8 27B (LM Studio Splash, 4-bit) as a
working agent inside Claude Code. Numbers below were measured on this box (M5 Pro,
64 GB), not estimated.

**Scope: Claude Code only.** Kiro and agy keep running on their own cloud models — see §5.3.

---

## 0. What exists

| # | Thing | Type | What it's for |
|---|---|---|---|
| 1 | `llm-serve` | CLI | Start/stop the model + proxy. Everything else assumes this is running. |
| 2 | `llm-proxy.mjs` | background service | Translates Anthropic ⇄ OpenAI so Claude Code can run on local weights. Started by `llm-serve`. |
| 3 | `qwen` | CLI | One-shot prompt. Run it yourself, or from a Claude Code Bash call. |
| 4 | `qwen-cli` | CLI | Interactive terminal chat (`lms chat`). |
| 5 | `qwen-code` | CLI wrapper | Claude Code pinned to the local model. What `claude local ...` calls. |
| 6 | `local-llm` plugin | Claude Code plugin | The `local-qwen` subagent + `local-llm` skill. **Never installed** — loaded per-session by #7. |
| 7 | `claude-local-subagent` | CLI wrapper | Claude Code on your **Pro subscription**, with the local subagent for that session only (`claude subagent`). |

### Everything here is opt-in

This setup is for deliberate experimentation and must never touch real work on the
Pro subscription. Two layers enforce that.

**Layer 1 — structural.** The `local-llm` plugin is staged in `~/.claude/local-plugins/`,
which Claude Code does *not* read. `claude subagent` loads it for one session with
`--plugin-dir`. Verified by asking each to enumerate its subagents:

| Command | `local-qwen` present? |
|---|---|
| `claude` | **No** — `agy:runner, claude, Explore, general-purpose, kiro:runner, Plan, statusline-setup` |
| `claude subagent` | **Yes** — same list plus `local-llm:local-qwen` |

**Layer 2 — behavioural.** Inside a `claude subagent` session, the subagent's and
skill's descriptions state they fire **only when you name the local model** ("ask
qwen", "use the local model", "run this locally"). A task being bulky or cheap is
explicitly *not* a reason to route it there.

`qwen`, `qwen-code` and `claude local ...` are inert until you run them, and plain
`claude` never routes anywhere but Anthropic.

---

## 1. The core problem, and why only Claude Code

Both local engines speak the **OpenAI** chat-completions API. Claude Code speaks the
**Anthropic Messages API**, and is the only one of the three harnesses that can be
pointed at an arbitrary endpoint (`ANTHROPIC_BASE_URL`). Two paths are used:

**A. Base-URL swap.** The proxy translates Anthropic ⇄ OpenAI, so Claude Code's entire
toolset — Read, Edit, Write, Bash, Grep, subagents — runs on local weights.

**B. Shell CLI.** `qwen` is a plain command, so it works from a Bash call inside any
session or straight from your terminal.

```
                 ┌─────────────────────────────────────────┐
                 │     LM Studio Splash :8089 (OpenAI)     │
                 │           Qwen 3.8 27B, 4-bit           │
                 └─────────────────────────────────────────┘
                     ▲                          ▲
        OpenAI HTTP  │                          │ HTTP
        ┌────────────┴───┐            ┌─────────┴─────┐
        │  llm-proxy     │            │  qwen  (CLI)  │
        │  :8790         │            │  one-shot     │
        │  Anthropic API │            └───────┬───────┘
        └────────┬───────┘                    │
          ANTHROPIC_BASE_URL            your shell, or a
                 │                      Claude Code Bash call
          ┌──────┴───────────┐                 │
          │ qwen-code        │        ┌────────┴──────────┐
          │ claude local ... │        │ local-qwen        │
          │ (Claude Code     │        │ subagent (opt-in) │
          │  on Qwen)        │        └───────────────────┘
          └──────────────────┘
```

---

## 2. Quick start

```bash
llm-serve start splash4    # loads Qwen 3.8 27B on Splash + proxy (~15 s)
llm-serve status           # what's resident, and is it healthy

qwen "explain this regex: ^\d{3}-\d{4}$"
git diff | qwen "write a conventional-commit message"
qwen-cli splash4           # interactive terminal chat

claude local qwen38_27                       # Claude Code, 100% local (Splash)
claude local qwen38_27 --think medium        # less reasoning, lower latency
claude local                                 # whatever is already resident

llm-serve stop             # frees the model
```

Plain `claude` still uses your Pro subscription. No Anthropic env vars are exported
globally — they are scoped inside the `qwen-code` process (see §10 if local traffic
ever leaks).

---

## 3. Which model

**Qwen 3.8 27B Splash only** (`splash4`: 4-bit + DFlash2 drafter on LM Studio's Splash
engine). `claude local qwen38_27 [--think xhigh|medium|low]` (default `--think xhigh`);
errors if LM Studio isn't installed. The proxy is model-agnostic, so a future model
slots in behind it unchanged.

**Splash** (measured 2026-09-27, LM Studio 0.4.25, Splash runtime 0.0.5, real Claude
Code sessions):

- Warm follow-ups **1–2 s**; 97–99% of every prompt cached after the first request
  (LM Studio log `Done · input N · cached M`), TTFT 0.4–0.9 s.
- Decode 35–84 t/s; cold 16k-token prefill ~33 s (~480 tok/s).
- Correct recall at **227,078 tokens** of context on the depth ladder (stopped before the 50 GB GPU-memory limit).
- Loads 262,144 ctx in ~15 s. Wired memory grows with context: ~22 GB at 62k, ~38 GB at
  199k, 44.8 GB at 227k (the GPU wired limit is 50 GB), so ~230k is the practical ceiling.
- `llm-serve` starts it with `lms server start --port 8089` + `lms load … --identifier
  qwen-local`, so the proxy and `qwen` talk to it unchanged.
- The downloaded model declares no reasoning capability, so LM Studio would drop
  `reasoning_effort`. `llm-serve` installs a virtual model
  (`dotfiles/lmstudio/qwen3.8-27b-splash/model.yaml` → `local/qwen3.8-27b-splash`)
  that maps it onto the template variable, so `--think` works on Splash too.

**Reasoning effort.** Qwen 3.8's template has exactly three levels: `xhigh` prepends a
"think carefully" instruction, `low` a "keep it brief" one, `medium` nothing. Default
is `xhigh` (`LLM_EFFORT`). `qwen-code` normalises `high`/`max`/`med`/`minimal` and
restarts only the proxy when a running stack is at another level.

---

## 4. The serving config

Claude Code's system prompt plus tool definitions alone measure **~23,000 tokens**, so
`llm-serve` serves the model's full native **262,144** window:

```bash
lms server start --port 8089
lms load local/qwen3.8-27b-splash --identifier qwen-local --context-length 262144 --gpu max -y
```

- **`--identifier qwen-local`** — a stable model name the proxy and `qwen` use.
- LM Studio owns the drafter and memory locking; sampling and `reasoning_effort` arrive
  per request from the proxy.
- Thinking is unlimited; the proxy heartbeat (§6) keeps a long reasoning phase from
  looking dead.

**Allocatable ≠ usable.** Prefill throughput falls with depth, so a very deep cold
prompt costs minutes before the first token. Keep sessions open (warm) rather than
resuming big ones cold. `LLM_CTX=131072 llm-serve restart` sets a hard cap.

---

## 5. Per-harness setup

### 5.1 Claude Code — full local agent loop

`qwen-code` sets the environment and execs `claude`:

```bash
qwen-code                          # interactive, on the resident model
qwen-code -p "fix the lint"        # headless
qwen-code --model splash4 -p "..." # start the model first, then run
```

| Variable | Why |
|---|---|
| `ANTHROPIC_BASE_URL=http://127.0.0.1:8790` | points Claude Code at the proxy |
| `ANTHROPIC_AUTH_TOKEN=local` | any non-empty value; the proxy ignores it |
| `ANTHROPIC_MODEL` / `ANTHROPIC_SMALL_FAST_MODEL` / `ANTHROPIC_DEFAULT_HAIKU_MODEL` = `qwen-local` | background chores would otherwise try to reach the real Haiku |
| `CLAUDE_CODE_MAX_CONTEXT_TOKENS=262144` (`LLM_CTX`) | Claude Code doesn't recognise `qwen-local` and would assume 200k. These are *estimated* tokens (chars/3.5); below 65536 blocks fresh sessions |
| `MAX_THINKING_TOKENS=0` | stops the harness requesting Anthropic extended thinking; the model still reasons |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` | keeps an offline session offline |
| `API_TIMEOUT_MS`, `CLAUDE_STREAM_IDLE_TIMEOUT_MS`, `CLAUDE_BYTE_STREAM_IDLE_TIMEOUT_MS` = 1800000 | long prefills (§6) |
| `unset ANTHROPIC_API_KEY` | an API key would take precedence and send real traffic to Anthropic |

Good for background chores and offline work; not a substitute for Opus on anything hard.

### 5.2 Claude Code — the `local-qwen` subagent

Available only in `claude subagent` sessions (§0). Delegate with
`subagent_type: "local-qwen"` when you asked for the local model and its output is
bulky enough that only the conclusion matters.

### 5.3 Kiro and agy — deliberately not integrated

**Kiro** supports MCP and briefly had an `ask_local_model` tool; it was removed to keep
the experiment confined to one harness (`~/.kiro/settings/mcp.json` is
`{"mcpServers": {}}`). **agy** ignores `mcpServers` in its settings (tested) and cannot
take a custom endpoint. To use a local answer in either, run `qwen` yourself.

---

## 6. Thinking, and the dead-connection failure it causes

The harness prompt is ~23k tokens and the model reasons on every turn, so a request
can go minutes without a visible token. A silent SSE stream looks dead to Claude Code
(`Waiting for API response · will retry…`).

**SSE heartbeats.** The proxy emits `event: ping` every 5 s (`PING_INTERVAL_MS`)
whenever upstream is silent.

**Heartbeats alone are not enough.** Claude Code runs two watchdogs:

| Watchdog | Env var | Default | Counts |
| --- | --- | --- | --- |
| byte | `CLAUDE_BYTE_STREAM_IDLE_TIMEOUT_MS` | 180 s | raw bytes — pings satisfy this |
| chunk | `CLAUDE_STREAM_IDLE_TIMEOUT_MS` | 300 s | content blocks — pings do **not** |

A prefill longer than 5 min therefore dies with `Stream idle timeout - no chunks
received` (measured trigger: a 141k-token resume prefilling for 660 s). `qwen-code`
sets both to 1800000. The chunk var is a floor (`max(env, 300000)`), and 1800000 is the
byte watchdog's hard ceiling.

**Visible reasoning.** `llm-serve` starts the proxy with `THINK_VIEW=native`: reasoning
is emitted as real Anthropic `thinking` blocks and Claude Code renders them. Their
signature is fake, but nothing validates it — the proxy *is* the server, and the
harness only round-trips the block back, where it is dropped.
`THINK_VIEW=off|status|text` for none, a compact heartbeat, or inline text.
`PROXY_THINK=0` disables reasoning entirely.

**Per-request switch.** `chat_template_kwargs: {"enable_thinking": false}` cuts output
~20x (289 → 14 tokens, same prompt). So:

- **Agent path (`qwen-code`):** thinking on.
- **Bulk path (`qwen` CLI):** thinking off by default; `--think` opts in
  (`--effort xhigh|medium|low`).

With a small `max_tokens`, thinking can consume the whole budget and return an empty answer.

---

## 7. Web search and fetch

Claude Code sends its own client-side tools:

```
WebSearch   { query, allowed_domains?, blocked_domains? }
WebFetch    { url, prompt }
```

- **`WebFetch` works as-is** — the harness fetches directly and summarises with the
  configured small model, which is the local one.
- **`WebSearch` does not** — it reaches Anthropic for the actual search, so against a
  local endpoint it returns `Did 0 searches`.

So the proxy intercepts `WebSearch` **by name** (`PROXY_HARNESS_TOOLS`, default
`WebSearch`), runs the search itself, forwards the harness's own schema untouched, and
re-prompts the model with the results inside the same Anthropic message. Anthropic
*server-side* tools (`web_search_2026…`, `web_fetch_…`) are handled the same way for any
harness that sends them. Tool calls are buffered until a round ends so the proxy can
tell which are its own to run.

| Env | Default | What |
|---|---|---|
| `WEB_TOOLS` | on | `WEB_TOOLS=0` stops standing in — the tools are then dropped, not offered |
| `SEARCH_BACKEND` | `duckduckgo` | `duckduckgo` (keyless) · `brave` · `searxng` |
| `BRAVE_API_KEY` | — | required for `SEARCH_BACKEND=brave` |
| `SEARXNG_URL` | — | required for `SEARCH_BACKEND=searxng` |
| `SEARCH_RESULTS` | 8 | results per search |
| `FETCH_MAX_CHARS` | 20000 | cap on a fetched page |
| `MAX_PROXY_HOPS` | 4 | search→answer rounds per turn; then the tools are withdrawn so the model must answer |

DuckDuckGo is scraped HTML and can rate-limit. Switch without reloading the model:

```bash
SEARCH_BACKEND=brave BRAVE_API_KEY=... llm-serve restart-proxy
```

Server-side tools with no local stand-in (code execution, computer use) are dropped
rather than offered.

---

## 8. Other proxy behaviour

- **Volatile-prompt stripping.** The hybrid model cannot reuse a partial prefix, so one
  changed byte in the system prompt forces a full re-prefill. The proxy strips Claude
  Code's per-turn `<total_tokens>` notes and the periodic "task tools haven't been used
  recently" nudge.
- **System hoisting.** Qwen 3.8's template rejects a system message after index 0, so
  all system content is merged into one leading message.
- **Images** are replaced with a note (the proxy is text-only).
- **`count_tokens`** is approximated (chars ÷ 3.5); it only drives compaction timing.
- **Debugging:** `DEBUG=1` logs each translated request; `DUMP_DIR=<dir>` writes them to
  files so you can diff consecutive payloads to see what broke the cache.
- `/health` reports the proxy's `effort`, which is how `qwen-code` and `llm-serve status`
  know the current `--think` level.

---

## 9. What to send local

**Send local:** summarising files, logs and diffs · docstrings and commit messages ·
explaining unfamiliar code · triaging search hits · first-draft boilerplate.

**Keep on Opus:** architecture and API design · security- and data-critical logic ·
multi-file refactors · subtle debugging · reviewing whatever the local model produced.

Delegate when the *prompt* is shorter than the *output*, and when being wrong is cheap
to detect.

---

## 10. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `cannot reach the model server` | `llm-serve start` |
| `claude local qwen38_27` says Splash is not installed | Install LM Studio and the Splash runtime + model (README §5.1). |
| `model not downloaded: incoai/Qwen3.8-27B-Splash` | `lms get https://huggingface.co/incoai/Qwen3.8-27B-Splash` — the bare name hits LM Studio Hub. |
| Plain `claude` starts using the local model | Something exported `ANTHROPIC_BASE_URL` globally. Check `env \| grep ANTHROPIC`. |
| Second request hangs | Look for a stray headless client holding the model: `ps -eo pid,etime,command \| grep "claude -p"`. |
| Empty turns deep into a session | Silent OOM near the GPU wired limit (~230k context). Start a fresh session; `llm-serve logs` for errors. |
| Starting seems to hang | It's reading the weights from disk. `llm-serve logs` to watch. |
| `Did 0 searches` from WebSearch | The harness ran its own WebSearch. `llm-serve logs proxy`: a `WebSearch {"query":...}` line means the proxy ran it; a line plus `ERROR:` means the backend failed — switch `SEARCH_BACKEND`. |
| `status` says stopped but something serves :8089 | An interrupted `start` left a listener without a pidfile. `llm-serve` adopts listeners on both ports on every command. |
| `Unable to connect to API (ConnectionRefused)` mid-session | The proxy died. Daemons run in their own session (`detach()`); check `ps -o pid,pgid -p $(cat ~/.local/state/local-llm/proxy.pid)` (pid should equal pgid). `llm-serve restart-proxy` brings it back without touching the model. |
| First turn of every session re-prefills ~20k tokens | Expected. The harness appends a static catalog after your prompt, and the hybrid model can't restore a partial prefix. Turn 2 onwards is warm; keep sessions open. |
| `Stream idle timeout - no chunks received` on a big resume | The chunk watchdog (§6). `qwen-code` already sets 1800000; beyond that, the prefill is simply too long — keep sessions warm instead of resuming cold. |
| `--think low` seems ignored on Splash | The LM Studio virtual model is missing or stale. `llm-serve restart splash4` reinstalls it. (`qwen-cli splash4` via `lms chat` always uses the model default.) |

---

## 11. What's installed where

| Path | What |
|---|---|
| `~/.local/bin/llm-serve` | start/stop/status for the whole stack |
| `~/.local/bin/llm-proxy.mjs` | Anthropic ⇄ OpenAI shim (port 8790) |
| `~/.local/bin/qwen` | one-shot CLI |
| `~/.local/bin/qwen-cli` | interactive terminal chat |
| `~/.local/bin/qwen-code` | Claude Code pinned to the local model |
| `~/.local/bin/claude-local-subagent` | Claude Code + the opt-in local subagent |
| `~/.claude/local-plugins/local-llm/` | the opt-in plugin. **Not** read by a plain `claude` |
| `~/.lmstudio/hub/models/local/qwen3.8-27b-splash/` | Splash virtual model (reasoning effort, sampling, context defaults), installed by `llm-serve start splash4` and `lmstudio-setup` |
| `~/.local/bin/lmstudio-setup` | LM Studio app tools: plugins, `~/.lmstudio/mcp.json`, Local Assistant preset, auto-approve (README §5.2) |
| `~/LMStudioFiles/` | the only folder the LM Studio filesystem MCP can touch |
| `~/.local/share/lmstudio-mcp/memory.jsonl` | the LM Studio memory MCP's store |
| `~/.local/state/local-llm/` | pidfiles, `current`, logs |

The `~/.local/bin` entries are symlinks into this repo. Reproducible on a new machine
with `./setup.sh`.
