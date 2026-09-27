# Wiring local Qwen 3.8 into Claude Code

How to use the locally-served Qwen 3.8 27B (LM Studio Splash or llama.cpp GGUF) as a
working agent inside Claude Code. Numbers below were measured on this box (M5 Pro,
64 GB), not estimated.

**Scope: Claude Code only.** Kiro and agy keep running on their own cloud models — see §5.3.

---

## 0. What exists

| # | Thing | Type | What it's for |
|---|---|---|---|
| 1 | `llm-serve` | CLI | Start/stop/switch the model + proxy. Everything else assumes this is running. |
| 2 | `llm-proxy.mjs` | background service | Translates Anthropic ⇄ OpenAI so Claude Code can run on local weights. Started by `llm-serve`. |
| 3 | `qwen` | CLI | One-shot prompt. Run it yourself, or from a Claude Code Bash call. |
| 4 | `qwen-cli` | CLI | Interactive terminal chat (`llama-cli`, or `lms chat` for Splash). |
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
                 │ llama-server or LM Studio :8089 (OpenAI) │
                 │   one Qwen 3.8 model resident at a time  │
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

claude local qwen38_27 --bits 4              # Claude Code, 100% local (Splash)
claude local qwen38_27                       # same model, 5-bit GGUF on llama.cpp
claude local qwen38_27 --think medium        # less reasoning, lower latency
claude local                                 # whatever is already resident

llm-serve stop             # frees the model
```

Plain `claude` still uses your Pro subscription. No Anthropic env vars are exported
globally — they are scoped inside the `qwen-code` process (see §10 if local traffic
ever leaks).

---

## 3. Which model

**Qwen 3.8 27B only.** `claude local qwen38_27 [--bits 4|5|6|8] [--think xhigh|medium|low]`
(default `--bits 5`, `--think xhigh`):

| `--bits` | Alias | Engine | Draft | Notes |
|---|---|---|---|---|
| 4 | `splash4` | LM Studio Splash, 4-bit + DFlash2 drafter | built in | fastest; deepest verified recall. Errors if LM Studio isn't installed. |
| 5 | `gguf5` | llama.cpp UD-Q5_K_XL | MTP n=2 | default; safe to ~200k |
| 6 | `gguf6` | llama.cpp UD-Q6_K_XL | MTP n=4 | |
| 8 | `gguf8` | llama.cpp Q8_0 | MTP n=3 | silent OOM (empty turns) near ~156k real context |

Only one model is resident; `llm-serve start <alias>` **replaces** whatever is loaded,
and the proxy survives the switch because it is model-agnostic.

**Splash** (measured 2026-09-27, LM Studio 0.4.25, Splash runtime 0.0.5, real Claude
Code sessions):

- Warm follow-ups **1–2 s**; 97–99% of every prompt cached after the first request
  (LM Studio log `Done · input N · cached M`), TTFT 0.4–0.9 s.
- Decode 35–84 t/s; cold 16k-token prefill ~33 s (~480 tok/s).
- Correct recall at **198,609 tokens** of context on the depth ladder (gguf5's best
  was 158,766).
- Loads 262,144 ctx in ~15 s. The weights are mapped from disk, so wired memory stays low.
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

## 4. The llama.cpp serving config

Claude Code's system prompt plus tool definitions alone measure **~23,000 tokens**, so
`llm-serve` serves the model's full native **262,144** window:

```bash
llama-server -m ~/Models/qwen3.8-27b-gguf/Qwen3.8-27B-UD-Q5_K_XL.gguf \
  --spec-type draft-mtp --spec-draft-n-max 2 \
  -c 262144 -ngl 99 -fa on -np 1 --mlock \
  --cache-ram 24576 --slot-save-path ~/.local/state/local-llm/kv \
  --jinja --reasoning-format deepseek --reasoning-budget -1 \
  --temp 1.0 --top-p 0.95 --top-k 20 \
  -a qwen-local --host 127.0.0.1 --port 8089 --no-webui
```

- **`--spec-type draft-mtp --spec-draft-n-max N`** — MTP at the measured peak per
  quant (2 for gguf5, 4 for gguf6, 3 for gguf8). `LLM_SPEC=0` disables it.
- **`--mlock`** — without it macOS evicts model pages under pressure and prefill
  collapses (196 → 4 tok/s measured). `LLM_MLOCK=0` opts out.
- **`--cache-ram 24576`** — a saved prompt state costs ~103 KB/token on this hybrid
  model; the 8 GiB default logs `exceeds cache size limit ... skipping` past ~79k tokens
  and cold-reprefills. Host RAM, not GPU-wired. `LLM_CACHE_RAM_MIB` overrides.
  (`--cache-reuse` is not used: it is a no-op on this hybrid architecture.)
- **`--slot-save-path`** — only enables the `/slots` save/restore endpoints; nothing
  calls them automatically.
- **`--reasoning-budget -1`** — unlimited thinking; the proxy heartbeat (§6) keeps a
  long reasoning phase from looking dead. `LLM_THINK_BUDGET` caps it.
- **`-np 1`** — required by MTP. One request at a time: a Claude Code session and a
  `qwen` call serialize.
- **`-a qwen-local`** — a stable model name, so nothing changes when you swap GGUFs.
- **`--reasoning-format deepseek`** — reasoning arrives in `reasoning_content`, not
  inline `<think>` tags, so the proxy can handle it deliberately.
- **`--jinja`** — required for tool calls.

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
qwen-code --model gguf6 -p "..."   # switch model first, then run
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

## 9. Concurrency: why not vLLM?

`-np 1` means requests queue. On this hardware the trade is concurrency *or* MTP:
llama.cpp needs a single slot for MTP, and vLLM is CUDA-first with no MTP for these
GGUFs, so it is slower at concurrency 1. With one user at the keyboard, keep MTP and
let requests queue. Revisit on an NVIDIA box.

---

## 10. What to send local

**Send local:** summarising files, logs and diffs · docstrings and commit messages ·
explaining unfamiliar code · triaging search hits · first-draft boilerplate.

**Keep on Opus:** architecture and API design · security- and data-critical logic ·
multi-file refactors · subtle debugging · reviewing whatever the local model produced.

Delegate when the *prompt* is shorter than the *output*, and when being wrong is cheap
to detect.

---

## 11. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `cannot reach llama-server` | `llm-serve start` |
| `claude local qwen38_27 --bits 4` says Splash is not installed | Install LM Studio and the Splash runtime + model (README §5.0), or use `--bits 5\|6\|8`. |
| `model not downloaded: incoai/Qwen3.8-27B-Splash` | `lms get https://huggingface.co/incoai/Qwen3.8-27B-Splash` — the bare name hits LM Studio Hub. |
| Plain `claude` starts using the local model | Something exported `ANTHROPIC_BASE_URL` globally. Check `env \| grep ANTHROPIC`. |
| Everything serializes / second request hangs | `-np 1` — one slot. Look for a stray headless client: `ps -eo pid,etime,command \| grep "claude -p"`. |
| Empty turns deep into a gguf8 session | Silent OOM near ~156k context. Use gguf5 or splash4 for deep sessions; grep the server log for `kIOGPUCommandBufferCallbackErrorOutOfMemory`. |
| Switching models seems to hang | It's reading the weights from disk. `llm-serve logs` to watch. |
| Tool calls never fire | `--jinja` missing — without it the chat template can't emit tool calls. |
| `couldn't bind HTTP server socket` when switching | Lingering `TIME_WAIT` on `:8089`; llama-server binds with `SO_REUSEPORT`, not `SO_REUSEADDR`. `llm-serve` stops the proxy first and waits for the port; by hand, wait ~30 s. |
| `Did 0 searches` from WebSearch | The harness ran its own WebSearch. `llm-serve logs proxy`: a `WebSearch {"query":...}` line means the proxy ran it; a line plus `ERROR:` means the backend failed — switch `SEARCH_BACKEND`. |
| `status` says stopped but something serves :8089 | An interrupted `start` left a daemon without a pidfile. `llm-serve` adopts listeners on both ports and recovers the model from argv on every command. |
| `Unable to connect to API (ConnectionRefused)` mid-session | The proxy died. Daemons run in their own session (`detach()`); check `ps -o pid,pgid -p $(cat ~/.local/state/local-llm/proxy.pid)` (pid should equal pgid). `llm-serve restart-proxy` brings it back without touching the model. |
| Prefill at single-digit tok/s | Memory pressure evicting model pages; `--mlock` should be on (don't set `LLM_MLOCK=0`). |
| First turn of every session re-prefills ~20k tokens | Expected. The harness appends a static catalog after your prompt, and the hybrid model can't restore a partial prefix. Turn 2 onwards is warm; keep sessions open. |
| `Stream idle timeout - no chunks received` on a big resume | The chunk watchdog (§6). `qwen-code` already sets 1800000; beyond that, the prefill is simply too long — keep sessions warm instead of resuming cold. |
| `--think low` seems ignored on Splash | The LM Studio virtual model is missing or stale. `llm-serve restart splash4` reinstalls it. (`qwen-cli splash4` via `lms chat` always uses the model default.) |

---

## 12. What's installed where

| Path | What |
|---|---|
| `~/.local/bin/llm-serve` | start/stop/switch/status for the whole stack |
| `~/.local/bin/llm-proxy.mjs` | Anthropic ⇄ OpenAI shim (port 8790) |
| `~/.local/bin/qwen` | one-shot CLI |
| `~/.local/bin/qwen-cli` | interactive terminal chat |
| `~/.local/bin/qwen-code` | Claude Code pinned to the local model |
| `~/.local/bin/claude-local-subagent` | Claude Code + the opt-in local subagent |
| `~/.claude/local-plugins/local-llm/` | the opt-in plugin. **Not** read by a plain `claude` |
| `~/.lmstudio/hub/models/local/qwen3.8-27b-splash/` | Splash virtual model, installed by `llm-serve start splash4` |
| `~/.local/state/local-llm/` | pidfiles, `current`, logs |
| `~/.local/state/local-llm/kv/` | `--slot-save-path` target; stays empty unless something calls `/slots` |

The `~/.local/bin` entries are symlinks into this repo. Reproducible on a new machine
with `./setup.sh`.
