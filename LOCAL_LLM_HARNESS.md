# Wiring local coding models into Claude Code

How to run local open-weight models (`Ornith-1.5-35B-A3B`, `Inkling-2-Mini`, `DaisyRose-27B` on `oMLX v0.8.1`, plus `Qwen 3.8 27B` on LM Studio Splash) inside Claude Code. Numbers below were measured on this box (M5 Pro, 64 GB, `iogpu.wired_limit_mb = 51200`), not estimated. See **[WALKTHROUGH_2026_11.md](WALKTHROUGH_2026_11.md)** for complete Nov 2026 Tier 1–4 benchmarks across 9 tested configurations.

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
llm-serve start ornith35   # loads Ornith-1.5-35B-A3B on oMLX + Anthropic proxy (~6 s)
llm-serve status           # what's resident, engine, context cap, and health
llm-serve which            # active alias (ornith35 | inkling2 | daisyrose27 | splash4)

qwen "explain this regex: ^\d{3}-\d{4}$"
git diff | qwen "write a conventional-commit message"
qwen-cli                   # interactive terminal chat

claude local ornith                          # Claude Code on Ornith-1.5-35B-A3B (default local)
claude local inkling2                        # Claude Code on Inkling-2-Mini oQ3e-mtp (TF32=0)
claude local daisyrose                       # Claude Code on DaisyRose-27B (pure-RL Qwen 3.8)
claude local qwen38_27                       # Claude Code on Qwen 3.8 27B (LM Studio Splash)
claude local ornith --think medium           # less reasoning, lower latency
claude local                                 # whatever is already resident (or starts ornith35)

llm-serve stop             # frees the model and proxy
```

Plain `claude` still uses your Pro subscription. No Anthropic env vars are exported
globally — they are scoped inside the `qwen-code` process (see §10 if local traffic
ever leaks).

---

## 3. Which models & engines

Four models across two engines (single-server rule on port `8089`, all defaulting to `--think xhigh`):

- **`ornith35` (`claude local ornith`, default):** `scottlowry/Ornith-1.5-35B-A3B-oQ4e-mtp` (35B-A3B MoE + MTP on `oMLX v0.8.1`, `ctx 262144`). Measured on M5 Pro 64 GB: **103.6 t/s** short decode (`86.9 t/s` mean in 12-turn Claude Code, `140 t/s` tool calls), **2,646 t/s** 16K cold prefill (`5.9 s` first turn, **0.61 s** warm follow-ups), `5/5` + Task 6 PASS (`697 s`, 0 timeouts), and **8/8** `stress-corpus` recall at `30.85 GB` wired.
- **`inkling2` (`claude local inkling2`):** `mlx-community/Inkling-2-Mini-oQ3e-mtp` (`thinkingmachines/Inkling-2-Mini` looped MoE + DSpark on `oMLX v0.8.1`, `MLX_ENABLE_TF32=0`, `ctx 131072`). `oMLX` runs with `--hot-cache-max-size 2GB`, `mtp_enabled: true`, `turboquant_kv_enabled: false`. Measured: `65.8 t/s` (`83.3 t/s` tools), `3.98 s` warm ping, `12/12` Tier 2 turns (`<=39.2 GB` wired), **8/8** depth recall (`<=40.5 GB` wired), **5/5 + Task 6 PASS** in Tier 4 (`3,953 s`). Accepts `--think none|minimal|low|medium|high|xhigh`.
- **`daisyrose27` (`claude local daisyrose`):** `krisfremen/DaisyRose-27B-oQ4e-mtp` (pure-RL Qwen 3.8 27B + MTP on `oMLX v0.8.1`, `ctx 131072`). Measured: `45.2 t/s` (`1.76 s` warm ping), `12/12` Tier 2 (`<=36.6 GB` wired), **5/5 + Task 6 PASS** with 0 timeouts (`2,481 s`).
- **`splash4` (`claude local qwen38_27`):** `incoai/Qwen3.8-27B-Splash` (4-bit + DFlash2 drafter on LM Studio Splash 1.3.0, `ctx 262144`). Measured: `73.7 t/s` 2K / `44.3 t/s` Tier 2 mean, **1.01 s** warm ping, `4/5 + Task 6 PASS` at `xhigh`. Kept via virtual model `dotfiles/lmstudio/qwen3.8-27b-splash/model.yaml`.

**Engine notes (`oMLX` + proxy):**
- `oMLX v0.8.1` runs headlessly via `/Applications/oMLX.app/Contents/MacOS/omlx-cli serve` using an isolated runtime base (`~/.local/state/local-llm/omlx-base`) and preloads each model via `/v1/models/<id>/load`.
- **Reasoning effort & families:** `llm-serve` persists `family`, `upstream_model`, `ctx`, `temp`, `top_p` in `~/.local/state/local-llm/` so `llm-proxy.mjs` and `qwen` adapt automatically (`chat_template_kwargs: {enable_thinking: false}` for Qwen 3.8/Ornith/DaisyRose vs `reasoning_effort: "none"` for Inkling 2 when thinking is off).
- **Case-insensitive tool canonicalization:** `llm-proxy.mjs` canonicalizes returned `tool_calls` names case-insensitively against the caller's requested `tools` array (fixing models that lowercase e.g. `bash` instead of `Bash`).

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
| `dyld: Library not loaded: ... libllhttp.X.dylib` / proxy abort | Node shared library mismatch (common after `brew upgrade` touches dependencies like `llhttp`). Fix: `brew upgrade node` (or `brew reinstall node`). |
| `claude local qwen38_27` says Splash is not installed | Install LM Studio and the Splash runtime + model (README §5.1). |
| `oMLX CLI not found` | Install `oMLX.app` (v0.8.1 DMG with Metal kernels) to `/Applications/oMLX.app`. |
| `model not downloaded: incoai/Qwen3.8-27B-Splash` | `lms get https://huggingface.co/incoai/Qwen3.8-27B-Splash` — the bare name hits LM Studio Hub. |
| Plain `claude` starts using the local model | Something exported `ANTHROPIC_BASE_URL` globally. Check `env \| grep ANTHROPIC`. |
| Second request hangs | Look for a stray headless client holding the model: `ps -eo pid,etime,command \| grep "claude -p"`. |
| Empty turns deep into a session | Silent OOM near the GPU wired limit. Start a fresh session; `llm-serve logs` for errors. |
| Starting seems to hang | It's reading the weights from disk. `llm-serve logs` to watch. |
| `Did 0 searches` from WebSearch | The harness ran its own WebSearch. `llm-serve logs proxy`: a `WebSearch {"query":...}` line means the proxy ran it; a line plus `ERROR:` means the backend failed — switch `SEARCH_BACKEND`. |
| `status` says stopped but something serves :8089 | An interrupted `start` left a listener without a pidfile. `llm-serve` adopts listeners on both ports on every command. |
| `Unable to connect to API (ConnectionRefused)` mid-session | The proxy died. Daemons run in their own session (`detach()`); check `ps -o pid,pgid -p $(cat ~/.local/state/local-llm/proxy.pid)` (pid should equal pgid). `llm-serve restart-proxy` brings it back without touching the model. |
| First turn of every session re-prefills ~20k tokens | Expected. The harness appends a static catalog after your prompt, and the hybrid/KV layout rebuilds once cleanly. Turn 2 onwards is warm; keep sessions open. |
| `Stream idle timeout - no chunks received` on a big resume | The chunk watchdog (§6). `qwen-code` already sets 1800000; beyond that, the prefill is simply too long — keep sessions warm instead of resuming cold. |
| `--think low` seems ignored on Splash | The LM Studio virtual model is missing or stale. `llm-serve restart splash4` reinstalls it. (`qwen-cli splash4` via `lms chat` always uses the model default.) |

---

## 11. What's installed where

| Path | What |
|---|---|
| `~/.local/bin/llm-serve` | start/stop/status for `oMLX` (`ornith35`, `inkling2`, `daisyrose27`) and `Splash` (`splash4`) |
| `~/.local/bin/llm-proxy.mjs` | Anthropic ⇄ OpenAI shim (port 8790, family/tool canonicalization) |
| `~/.local/bin/qwen` | one-shot CLI |
| `~/.local/bin/qwen-cli` | interactive terminal chat (REPL for oMLX, `lms chat` for Splash) |
| `~/.local/bin/qwen-code` | Claude Code pinned to the local model |
| `~/.local/bin/claude-local-subagent` | Claude Code + the opt-in local subagent |
| `~/.claude/local-plugins/local-llm/` | the opt-in plugin. **Not** read by a plain `claude` |
| `~/Models/{ornith-35b-a3b-oq4e-mtp,inkling2-mini-oq3e-mtp,daisyrose-27b-oq4e-mtp}` | pinned local oMLX weights (`llm-serve start` links active one cleanly) |
| `~/.lmstudio/hub/models/local/qwen3.8-27b-splash/` | Splash virtual model (reasoning effort, sampling, context defaults), installed by `llm-serve start splash4` and `lmstudio-setup` |
| `~/.local/bin/lmstudio-setup` | LM Studio app tools: plugins, `~/.lmstudio/mcp.json`, Local Assistant preset, auto-approve (README §5.2) |
| `~/LMStudioFiles/` | the only folder the LM Studio filesystem MCP can touch |
| `~/.local/share/lmstudio-mcp/memory.jsonl` | the LM Studio memory MCP's store |
| `~/.local/state/local-llm/` | pidfiles, `current`, `engine`, `family`, `ctx`, `omlx-base/`, logs |

The `~/.local/bin` entries are symlinks into this repo. Reproducible on a new machine
with `./setup.sh`.
