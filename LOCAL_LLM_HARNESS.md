# Wiring local Qwen 3.6 into Claude Code

How to use the two locally-served Qwen 3.6 models as working agents inside Claude
Code. Every number and command below was measured or executed on this box
(M5 Pro, 64 GB), not estimated.

**Scope: Claude Code only.** Kiro and agy were evaluated and deliberately left
out — see §0. They keep running on their own cloud models.

---

## 0. What exists — the whole inventory

Six pieces were added. Nothing else changed, and **plain `claude` is untouched**.
Kiro and agy have nothing installed at all.

| # | Thing | Type | What it's for |
|---|---|---|---|
| 1 | `llm-serve` | CLI | Start/stop/switch the model + proxy. Everything else assumes this is running. |
| 2 | `llm-proxy.mjs` | background service | Translates Anthropic ⇄ OpenAI so **Claude Code** can run on local weights. Started automatically by `llm-serve`. |
| 3 | `qwen` | CLI | One-shot prompt. Run it yourself, or from a Claude Code Bash call. |
| 4 | `qwen-code` | CLI wrapper | Launches Claude Code pinned to a local model. What the `claude local ...` dispatcher branches call. |
| 5 | `local-llm` plugin | Claude Code plugin | Bundles the `local-qwen` subagent + `local-llm` skill. **Never installed** — loaded per-session by #6. |
| 6 | `claude-local-subagent` | CLI wrapper | Claude Code on your **Pro subscription**, with the local subagent available for that session only. |

And what each harness actually got:

| Harness | What it got | How you use it |
|---|---|---|
| **Claude Code** | Everything — proxy, opt-in subagent, CLI | `claude local qwen36_35`, or `claude subagent`, or run `qwen` yourself |
| **Kiro** | **Nothing — removed** | n/a |
| **agy** | **Nothing** | n/a |

> **Deliberately Claude Code only.** An earlier revision registered an MCP server
> (`ask_local_model`) with Kiro. That has been **removed** — `~/.kiro/settings/mcp.json`
> is now `{"mcpServers": {}}`, and the MCP server script is deleted. agy never had
> anything: it ignores `mcpServers` in its settings (tested directly) and its tool
> list is fixed.
>
> The local models are an experiment, and confining them to one harness keeps the
> blast radius small. Kiro and agy do their real work on their own cloud models,
> untouched.

### Everything here is opt-in

This setup is for **deliberate experimentation**. It must never touch real work
done on the Claude Pro subscription. Two layers enforce that.

**Layer 1 — structural (Claude Code): the subagent doesn't exist unless you ask
for it.** The `local-llm` plugin is installed to `~/.claude/local-plugins/`,
which Claude Code does *not* read. It is **not** in `~/.claude/plugins/`,
`~/.claude/agents/`, or `~/.claude/skills/`. `claude-local-subagent` loads it for
one session with `--plugin-dir`. This is not a heuristic — the agent is absent
from the session entirely.

Verified by asking each to enumerate its own subagents:

| Command | `local-qwen` present? |
|---|---|
| `claude` | **No** — `agy:runner, claude, Explore, general-purpose, kiro:runner, Plan, statusline-setup` |
| `claude subagent` | **Yes** — same list plus `local-llm:local-qwen` |

**Layer 2 — behavioural (inside a `claude subagent` session).** Once the
plugin *is* loaded, the subagent's and skill's descriptions state that they fire
**only when you name the local model in the request** ("ask qwen", "use the local
model", "run this locally"), and that a task being bulky, repetitive, or cheaper
to run locally is explicitly *not* a reason to route it there.

The user-driven entry points (`qwen`, `qwen-code`, `claude local ...`) are inert
until you run them, and plain `claude` never routes anywhere but Anthropic.

Because Kiro and agy have no local integration at all, they need no guard.

---

## 1. The core problem, and why only Claude Code

`llama-server` speaks the **OpenAI** chat-completions API. Claude Code speaks the
**Anthropic Messages API**. Bridging those two is what unlocks everything else.

| Harness | Talks | Can it point at a local endpoint? | Status |
|---|---|---|---|
| **Claude Code** | Anthropic Messages API | **Yes** — `ANTHROPIC_BASE_URL` | Fully integrated |
| **Kiro** (`kiro-cli`) | Fixed cloud model list | No | **Not integrated** (removed) |
| **Antigravity** (`agy`) | Fixed cloud model list | No | **Not integrated** |

Claude Code is the only one of the three that can be pointed at an arbitrary
endpoint, which makes it the only one where a local model gets *real agency*
rather than being a question-answering sidecar. Two paths are used:

**A. Base-URL swap.** A ~400-line shim translates Anthropic Messages ⇄ OpenAI,
so Claude Code's *entire* toolset — Read, Edit, Write, Bash, Grep, subagents —
runs on local weights.

**B. Shell CLI.** `qwen` is a plain command, so it works from a Bash call inside
any session (or straight from your terminal). This is the workhorse for bulk
text work.

Kiro and agy were both evaluated. Kiro supports MCP and briefly had an
`ask_local_model` tool registered; it was removed to keep the experiment confined
to one harness. agy never had anything — it **ignores** an `mcpServers` block in
`~/.gemini/antigravity-cli/settings.json` (tested directly; the tool never
appears in its 17-tool list) and cannot take a custom endpoint.

```
                 ┌─────────────────────────────────────────┐
                 │   llama-server  :8089  (OpenAI API)      │
                 │   one Qwen 3.6 GGUF resident at a time   │
                 └─────────────────────────────────────────┘
                     ▲                          ▲
        OpenAI HTTP  │                          │ HTTP
                     │                          │
        ┌────────────┴───┐            ┌─────────┴─────┐
        │  llm-proxy     │            │  qwen  (CLI)  │
        │  :8790         │            │  one-shot     │
        │  Anthropic API │            │               │
        └────────┬───────┘            └───────┬───────┘
                 │                            │
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
llm-serve start            # loads 35B A3B + proxy (~7 s warm, ~40 s cold)
llm-serve status           # what's resident, and is it healthy

qwen "explain this regex: ^\d{3}-\d{4}$"        # one-shot, ~1 s
git diff | qwen "write a conventional-commit message"

claude local qwen36_35     # interactive Claude Code, 100% local
claude local qwen38_27     # same, on the 27B dense model

llm-serve stop             # frees ~36 GB
```

`claude` on its own is untouched and still uses your **Claude Pro subscription**.
No Anthropic env vars are exported globally — they are scoped inside the
`qwen-code` process only. (See §10 if you ever see local traffic leak.)

---

## 3. Which model, and why

From `local_llm_bench` (`REPORT.md`), Q8 with MTP speculative decoding at the
measured-optimal draft depth:

| | **35B A3B** (MoE) | **27B** (dense) |
|---|---|---|
| decode | **67.2 tok/s** (draft-n=1, 78% accept) | 17.7 tok/s (draft-n=2, 68% accept) |
| prompt processing | ~910 tok/s | ~275 tok/s |
| TTFT | ~235 ms | ~750 ms |
| judged quality | not separately graded | **8.7 / 10** |
| resident RSS @ 65k ctx | 36.3 GB | 28.4 GB |

> These are **shallow-context** figures. Prompt-processing throughput degrades
> sharply with depth: the 35B's ~910 tok/s headline measured **214 tok/s** on a
> 141k-token resume. Budget deep-context prefill off the degraded rate, not this
> table — see §6 on the idle watchdogs.

**Default to 35B A3B.** It is ~3.8x faster to decode and ~3.3x faster to prefill.
For an agent loop — which is many round-trips of a large prompt — that gap is the
difference between usable and unusable. Reach for the 27B only when a single
answer's quality justifies waiting roughly 4x longer.

Only one fits in 64 GB, so `llm-serve start <model>` **replaces** the resident
one (verified: 35b→27b switches cleanly, and the proxy survives it because it is
model-agnostic).

**The 27B now serves from MLX, not llama.cpp** (changed 2026-08-15 after the Qwen
3.8 quant sweep). Aliases `mlx8` / `mlx6` / `mlx4` launch `mlx_vlm.server`; `27b`
remains the llama.cpp fallback. MLX beat llama.cpp at every matched size — 13.55 vs
12.51 tok/s at 8-bit, 16.55 vs 10.40 at 6-bit — and matched its warm-cache TTFT
(1.28 s vs 1.50 s), which is what makes the decode win actually count. On Qwen 3.6
the same comparison went the other way because MLX re-prefilled the whole preamble
every turn; on 3.8 its prompt cache engages.

The speed gap above still holds against the 35B, so it remains the default for
agent loops. The MLX 27B narrows the gap rather than closing it.

---

## 4. The serving config — and why it differs from the benchmark's

The benchmark serves at `-c 16384`, which is correct for benchmarking and
**useless for a harness**: Claude Code's system prompt plus tool definitions
alone measure **~23,000 tokens**, so a 16k window can't even hold the preamble.

`llm-serve` serves at the model's full native **262,144** with a quantized KV
cache and MTP speculative decoding:

```bash
llama-server -m ~/Models/qwen3.6-35b-a3b-mtp-q8/Qwen3.6-35B-A3B-Q8_0.gguf \
  --spec-type draft-mtp --spec-draft-n-max 1 \
  -c 262144 -ngl 99 -fa on -np 1 \
  --jinja --reasoning-format deepseek --reasoning-budget -1 \
  --temp 0.6 --top-p 0.95 --top-k 20 \
  -a qwen-local --host 127.0.0.1 --port 8089
```

What each harness-specific flag buys you:

- **`-c 262144`** — the full trained window. Measured cost on the 35B: **37.7 GB
  resident, only +1.4 GB over 65k.** These Qwen MoE models use very few KV
  heads, so deep context is nearly free to *allocate*. (See the caveat below —
  it is not free to *use*.)
- **`-ctk q8_0 -ctv q8_0`** — quantizes the KV cache, which is what makes the
  full window affordable at all.
- **`--spec-type draft-mtp --spec-draft-n-max N`** — **yes, MTP is on**, at the
  benchmarked peak depth per model: **n=1 for the 35B A3B** (78% accept, 1.21x)
  and **n=2 for the 27B** (68% accept, 1.80x). `llm-serve` picks this per model;
  you never pass it by hand.
- **`--reasoning-budget -1`** — thinking is **unlimited**. The quality of these
  models comes from letting them finish; the proxy's heartbeat (§6) is what stops
  a long reasoning phase from looking like a dead connection.
- **`-np 1`** — required by MTP. It also means **one request at a time**: the
  server has a single slot, so a Claude Code session and a `qwen` call will
  serialize, not parallelize. If a command seems to hang, check whether another
  session is mid-generation.
- **`-a qwen-local`** — a stable model alias, so harness config never changes
  when you swap GGUFs underneath.
- **`--reasoning-format deepseek`** — puts thinking in a separate
  `reasoning_content` field instead of inline `<think>` tags, which is what lets
  the proxy handle it deliberately rather than leaking tags into answers.

### The 250K caveat: allocatable ≠ usable

Memory is *not* the limit on deep context — throughput is. Prompt processing
degrades badly as the prompt grows; measured on this machine, the rate decays
steadily with depth (394 → 252 tok/s across a single 24k-token prefill). At that
rate a **100k-token prompt costs roughly 7 minutes of prefill before a single
token is generated**, and the full 262k window is hours.

So the window is set to 262,144 because it costs almost nothing to reserve and
removes any hard ceiling — but the *practical* working range on 64 GB is bounded
by patience, not RAM. Treat anything past ~50k tokens as a batch job, not an
interactive one. `LLM_CTX=65536 llm-serve restart` if you prefer a hard cap.

---

## 5. Per-harness setup

### 5.1 Claude Code — full local agent loop

`qwen-code` sets the environment and execs `claude`:

```bash
qwen-code                       # interactive
qwen-code -p "fix the lint"     # headless
qwen-code --model 27b -p "..."  # switch model first, then run
```

The environment that makes it work, and why each var is needed:

| Variable | Why |
|---|---|
| `ANTHROPIC_BASE_URL=http://127.0.0.1:8790` | points Claude Code at the proxy |
| `ANTHROPIC_AUTH_TOKEN=local` | any non-empty value; the proxy ignores it |
| `ANTHROPIC_MODEL=qwen-local` | main model |
| `ANTHROPIC_SMALL_FAST_MODEL` / `ANTHROPIC_DEFAULT_HAIKU_MODEL` | background chores (titles, summaries) would otherwise try to reach the real Haiku |
| `CLAUDE_CODE_MAX_CONTEXT_TOKENS=65536` | **essential.** Claude Code doesn't recognise `qwen-local` and otherwise assumes a 200k window, so auto-compact fires far too late and the server truncates mid-task |
| `MAX_THINKING_TOKENS=0` | stops the harness requesting extended thinking it can't get |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` | keeps an offline session offline |
| `unset ANTHROPIC_API_KEY` | an API key would take precedence over the auth token and send real traffic to Anthropic |

**Measured behaviour** (35B A3B, Q8, 65k ctx):

- read a file and answer one question — **49 s**
- fix a bug, write a test file, run it with `python3` (3 tool round-trips) —
  **1 m 51 s**, correct on the first attempt

That is genuinely usable for background chores and offline work. It is not a
substitute for Opus on anything hard.

### 5.2 Claude Code — the `local-qwen` subagent

Installed at `~/.claude/agents/local-qwen.md`. Delegate with
`subagent_type: "local-qwen"` when the local model's output is bulky and only the
conclusion matters — it keeps that output out of the parent context, exactly like
`agy:runner` and `kiro:runner`.

### 5.3 Kiro and agy — deliberately not integrated

Neither has any local-model integration, by choice.

**Kiro** supports MCP, and an earlier revision registered an `ask_local_model`
tool with it (verified working, 1.96 s round-trip). It has since been
**removed**: `~/.kiro/settings/mcp.json` is now `{"mcpServers": {}}` and the MCP
server script is deleted. Confirmed by asking Kiro to use it — it replies that it
has no such tool and answers from its own model.

**agy** never had anything. It ignores `mcpServers` in its settings (tested — the
tool never appears in its tool list) and its model list is cloud-only.

Both keep doing their real work on their own cloud models. If you ever want a
local answer inside one of them, run `qwen` yourself and paste the result; there
is no wiring to re-enable.

---

## 6. Thinking, and the dead-connection failure it causes

Both models are reasoning models and, left alone, spend **~4,000–5,500 tokens
thinking** before answering. Thinking is left **on** in the agent path — it is
where these models' quality comes from — but it has a sharp operational edge.

### The failure

Firing up `claude local qwen38_27` produced:

```
✻ Waiting for API response · will retry in 4m 33s · check your network
```

Nothing was wrong with the network. Three things compounded:

1. The harness prompt is **~23k tokens**, and the 27B prefills at only ~300 tok/s
   → **~85 s before the first token is even generated**.
2. Thinking was unlimited at 17.7 tok/s → **minutes more** before any *answer*.
3. `--reasoning-format deepseek` puts that reasoning in `reasoning_content`,
   which the proxy deliberately does not forward — so it emitted `message_start`
   and then **nothing at all for over five minutes**. Claude Code correctly
   concluded the stream was dead and retried.

Measured directly: response headers arrive at **0.16 s**, but the first SSE byte
only at **12.19 s** on a small prompt — the silence starts immediately and grows
with prompt size.

### The fix: SSE heartbeats

The proxy now emits `event: ping` every 5 s whenever the upstream has been
silent, for the entire life of the request. The harness sees a live connection
through both prefill and reasoning. `qwen-code` also sets
`API_TIMEOUT_MS=1800000` as a backstop.

#### Heartbeats are not sufficient on their own

Pings keep the *socket* alive but do not count as *chunks*, and Claude Code runs
two independent watchdogs:

| Watchdog | Env var | Default | Counts |
| --- | --- | --- | --- |
| byte | `CLAUDE_BYTE_STREAM_IDLE_TIMEOUT_MS` | 180 s (first-party) | raw bytes — pings satisfy this |
| chunk | `CLAUDE_STREAM_IDLE_TIMEOUT_MS` | 300 s | content blocks — pings do **not** |

`API_TIMEOUT_MS` bounds the whole request and never binds first. So a prefill
longer than 5 minutes still dies with `Stream idle timeout - no chunks
received`, heartbeat notwithstanding — the CLI throws exactly that when the
chunk watchdog trips with zero content blocks yielded.

Observed on the 35B A3B: a resumed 141k-token session measured

```
prompt eval time = 659681.54 ms / 141540 tokens (4.66 ms/tok, 214.56 tok/s)
```

660 s of prefill against a 300 s chunk watchdog. Note the 214 tok/s versus the
~910 tok/s headline figure above: prefill throughput degrades sharply with
context depth, so deep-context resumes are several times slower per token than
the shallow benchmark suggests.

`qwen-code` therefore also sets both idle vars to 1800000. Two caveats:
`CLAUDE_STREAM_IDLE_TIMEOUT_MS` is a floor — `max(env, 300000)` — so it can only
be raised above 5 min, never lowered; and 1800000 is the byte watchdog's hard
ceiling, so that is the most that can be bought.

This only stops the crash. You still wait out the prefill, which is why
`--cache-reuse 256` matters more in practice: it salvages matching chunks via KV
shifting instead of all-or-nothing prefix matching, so a changed system prompt
at position 0 no longer invalidates everything behind it. `--slot-save-path`
merely *enables* the `/slots/{id}?action=save|restore` endpoints — llama.cpp
does not persist or reload slots on its own, so nothing uses them until
something calls them.

A second, subtler failure this also explains: with a small `max_tokens`, thinking
can consume the **entire budget and return zero content** — a request capped at
64 tokens produced 64 thinking tokens and an empty answer.

### The per-request switch

Thinking is controlled by `chat_template_kwargs: {"enable_thinking": false}`, and
the effect on cost is dramatic — same prompt, measured here:

| | tokens generated |
|---|---|
| thinking on | 289 |
| thinking off | **14** |

That ~20x gap is why the split is deliberate:

- **Agent path (`qwen-code`, Claude Code):** thinking **on**. Quality matters,
  and the heartbeat covers the latency. `PROXY_THINK=0` to disable.
- **Bulk path (`qwen` CLI):** thinking **off** by default, since summarising and
  drafting gain nothing from it. `--think` opts in per call.

```bash
qwen "summarise this log" -f app.log                    # off — bulk work
qwen --think "why would this deadlock?" -f worker.go    # on — real analysis
```

> `MAX_THINKING_TOKENS=0` in `qwen-code` controls the **harness**, not the model
> — it stops Claude Code requesting Anthropic-style thinking blocks it can't get.
> The local model still reasons normally.

---

## 7. Web search and fetch

There are two different web-tool mechanisms in play, and only one of them is
what Claude Code actually uses. Capturing a real request (`DUMP_DIR`) settles
it — the binary contains `web_search_20260209` strings, but the harness sends:

```
WebSearch   { query, allowed_domains?, blocked_domains? }   <- client-side, has input_schema
WebFetch    { url, prompt }                                 <- client-side, has input_schema
```

Both are **client-side tools the harness runs itself**, not the API's
server-side `web_search`. That distinction decides everything:

- **`WebFetch` works as-is.** It fetches directly and summarises the page with
  whatever small model is configured — which is the local one. Leave it alone.
- **`WebSearch` does not.** Its implementation reaches Anthropic for the actual
  search, so against a local endpoint it returns `Did 0 searches`. The call
  looks like it ran; it just finds nothing.

So the proxy intercepts `WebSearch` **by name** (`PROXY_HARNESS_TOOLS`,
default `WebSearch`) and runs it here, forwarding the harness's own schema
untouched so the model sees exactly the tool it expects. `WebFetch` is
deliberately not in that list.

The server-side path below is also handled, for any harness that does use it:

```
model emits   web_search{query}      ← intercepted here; never reaches the harness
proxy runs    the search
proxy appends assistant tool_call + tool result to the conversation
proxy re-prompts the model, streaming the next round into the SAME message
```

The harness sees one continuous reply and never learns a search happened —
which is exactly how the server-side tools behave against the real API. Since a
round can end in either kind of tool call, tool calls are buffered until the
round ends; only then can the proxy tell which are its own to run and which
belong to the harness.

| Env | Default | What |
|---|---|---|
| `WEB_TOOLS` | on | `WEB_TOOLS=0` stops standing in — the tools are then dropped, not offered |
| `SEARCH_BACKEND` | `duckduckgo` | `duckduckgo` (keyless) · `brave` · `searxng` |
| `BRAVE_API_KEY` | — | required for `SEARCH_BACKEND=brave` |
| `SEARXNG_URL` | — | required for `SEARCH_BACKEND=searxng` |
| `SEARCH_RESULTS` | 8 | results per search |
| `FETCH_MAX_CHARS` | 20000 | cap on a fetched page |
| `MAX_PROXY_HOPS` | 4 | search→answer rounds per turn; afterwards the tools are withdrawn so the model must answer |

The default backend scrapes DuckDuckGo's HTML endpoint: no key, so it works on a
fresh machine with nothing configured. It is scraped HTML though, so it can
rate-limit or change shape. Switch backends without reloading the model:

```bash
SEARCH_BACKEND=brave BRAVE_API_KEY=... llm-serve restart-proxy
```

Server-side tools the proxy *can't* stand in for (code execution, computer use)
are dropped rather than forwarded — offering the model a tool that nothing will
ever execute just produces dead tool calls.

---

## 8. Concurrency: why not vLLM?

`-np 1` means one request at a time, so a `qwen` call fires while a `qwen-code`
session is mid-turn will queue behind it. The obvious thought is vLLM for real
batching. On this hardware, don't.

**The trade is concurrency *or* MTP — on either engine.** llama.cpp requires a
single slot for MTP speculative decoding, so `-np 2` costs you the same 1.21x
(35B) to 1.80x (27B) speedup that vLLM's lack of MTP support costs you. There is
no configuration here that gives both.

vLLM specifically is the weaker side of that trade on an M5 Pro:

- It is **CUDA-first**. Apple Silicon support is experimental, and there is no
  Metal paged-attention path competitive with llama.cpp's Metal backend.
- **No MTP for these GGUFs**, which is exactly what you measured — slower at
  concurrency 1, because you pay the engine's overhead and forfeit the speedup.
- vLLM's advantage is *aggregate throughput under many concurrent requests*. With
  one human at the keyboard, you are optimising the wrong number: continuous
  batching improves tokens/sec across N streams, not latency of the one stream
  you're waiting on.

**So keep llama.cpp + MTP and let requests queue.** If you genuinely need two
things at once, the better lever is a *second llama-server on another port* with
a small model for the bulk path — but RAM is the binding constraint here: the two
Q8 Qwens are 29 GB + 38 GB and cannot co-reside in 64 GB. A small side model
(3–8B) alongside the 27B is the only combination that fits.

Revisit vLLM if you move to an NVIDIA box, where batching and MTP-style
speculators are both first-class.

---

## 9. What to actually send local

The local models are free, private, and unmetered but slow. Route by whether
volume matters more than peak reasoning.

**Send local:** summarising files, logs, and diffs · docstrings and comments ·
changelogs and commit messages · explaining unfamiliar code or regexes ·
triaging search hits ("which of these 40 matches are relevant?") · first-draft
boilerplate · anything you'd otherwise skim yourself.

**Keep on Opus:** architecture and API design · security- and
data-integrity-critical logic · multi-file refactors · debugging anything subtle
· reviewing whatever the local model produced.

The honest test: delegate when the *prompt* is shorter than the *output*, and
when being wrong is cheap to detect.

---

## 10. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `cannot reach llama-server` | `llm-serve start` |
| Claude Code warns *"qwen-local is not a model this version recognizes"* | Harmless, but set `CLAUDE_CODE_MAX_CONTEXT_TOKENS` or it assumes 200k. `qwen-code` already does. |
| Plain `claude` starts using the local model | Something exported `ANTHROPIC_BASE_URL` globally. Check `env \| grep ANTHROPIC` — `~/.zshrc` has two *commented-out* lines near the top from an old experiment; leave them commented. |
| Everything serializes / second request hangs | `-np 1` is a hard requirement of MTP — one slot, one request at a time. |
| Truncated or confused long sessions | Context exhaustion. Raise `-c` (`LLM_CTX=131072 llm-serve restart`) and match `CLAUDE_CODE_MAX_CONTEXT_TOKENS`. |
| Answers are slow but fine | Thinking is on. Drop `--think`. |
| Switching models seems to hang | It's reading 28–38 GB from disk. Cold start ~40 s; `llm-serve logs` to watch. |
| Tool calls never fire | `--jinja` missing — without it the chat template can't emit tool calls. |
| `couldn't bind HTTP server socket` when switching models | The proxy's keep-alive connections to the old llama-server linger in `TIME_WAIT` on `:8089`, and llama-server binds with `SO_REUSEPORT` (not `SO_REUSEADDR`), so it cannot rebind over them. `llm-serve` now stops the proxy *before* the server and waits for the port to clear; if you hit this driving llama-server by hand, wait ~30 s. |
| `Did 0 searches` in the WebSearch tool output | The harness ran its *own* WebSearch, which needs Anthropic to do the searching. The proxy must intercept it by name instead — see §7. Confirm with `llm-serve logs proxy`: a `WebSearch {"query":...}` line means we ran it, no line means the call went to the harness. A line plus `ERROR:` means the backend failed, and DuckDuckGo rate-limits, so switch `SEARCH_BACKEND`. |
| `status` says stopped but something is clearly serving :8089 | A `start` interrupted partway (Ctrl-C while the model loads) leaves a live daemon and no pidfile. `llm-serve` now reconciles on every command: it adopts whatever is listening on the two ports and recovers the model name from the server's own `-m` argument, so `status`, `stop` and `start` all behave. Nothing to do by hand. |
| `Unable to connect to API (ConnectionRefused)` mid-session | The proxy died. It used to inherit the process group of whatever shell started it, so a Ctrl-C, a closed terminal or a script killed on timeout took it down — `nohup` only covers SIGHUP. `llm-serve` now starts both daemons via `detach()`, which puts them in their own session; verify with `ps -o pid,pgid -p $(cat ~/.local/state/local-llm/proxy.pid)` — pid should equal pgid. `llm-serve restart-proxy` brings it back without touching the model. |
| A turn takes *minutes*, and `llm-serve logs` shows prefill at single-digit tok/s | Memory pressure. A 27–38 GB model on a 64 GB machine leaves little headroom, and macOS compresses or evicts model pages whenever Spotlight, `contactsd` and friends get busy. Generation barely notices (it is bandwidth-light per token) but prefill sweeps every weight per batch, so it falls off a cliff — measured on an *idle* server: 196 → 4 tok/s. `llm-serve` now passes `--mlock` to pin the weights; the same run then held 79 tok/s. `LLM_MLOCK=0` opts out. |
| The first turn of every session re-prefills ~20k tokens | Expected, and not fixable from here. The stable prefix (system prompt + tool schemas) is ~16.6k tokens, but the harness appends a static agent/skills catalog *after* your prompt — so a new prompt invalidates everything from that point on. Qwen 3.6 needs a context checkpoint at or below the divergence to restore, and checkpoints only ever exist above it, so llama.cpp re-processes the lot. Within a session it is fine: turn 2 onwards appends to a matching prefix and comes back in ~2 s. Keep sessions open rather than restarting them. |
| `API Error: Stream idle timeout - no chunks received` when resuming a big session | The SSE heartbeat is working and is not the problem. Claude Code runs two watchdogs and a ping only satisfies one: the byte watchdog (`CLAUDE_BYTE_STREAM_IDLE_TIMEOUT_MS`, 180 s) counts raw bytes, the chunk watchdog (`CLAUDE_STREAM_IDLE_TIMEOUT_MS`, 300 s) counts content blocks. A ping is bytes, not a chunk, so any prefill over 5 min dies regardless. `API_TIMEOUT_MS` bounds the whole request and never binds first. `qwen-code` now sets both idle vars to 1800000 — note the chunk one is a floor, `max(env, 300000)`, so it can only be raised, and 1800000 is the byte watchdog's hard ceiling. Measured trigger: a 141k-token resume prefilled 660 s at 214 tok/s. See §6. |
| Two sessions at once, or a stray `claude -p` left running | Fatal to latency. `-np 1` means one slot, so a forgotten headless client interleaves with your real request and both crawl. `ps -eo pid,etime,command \| grep "claude -p"` finds them. |

---

## 11. What's installed where

| Path | What |
|---|---|
| `~/.local/bin/llm-serve` | start/stop/switch/status for the whole stack |
| `~/.local/bin/llm-proxy.mjs` | Anthropic ⇄ OpenAI translation shim (port 8790) |
| `~/.local/bin/qwen` | one-shot CLI — the universal integration |
| `~/.local/bin/qwen-code` | Claude Code pinned to a local model |
| `~/.local/bin/claude-local-subagent` | Claude Code + the opt-in local subagent |
| `~/.claude/local-plugins/local-llm/` | the opt-in plugin (subagent + skill). **Not** read by a plain `claude` |
| `~/.local/state/local-llm/` | pidfiles, `current`, logs |
| `~/.local/state/local-llm/kv/` | `--slot-save-path` target. Created on start; stays empty unless something calls the `/slots` save/restore endpoints |

All of it is reproducible on a new machine with `./setup.sh` from this repo.

---

## 12. Known limits

- **Text only.** Neither model has vision; the proxy replaces image blocks with
  a note rather than failing.
- **Thinking is always on, and now visible.** The model reasons on every turn
  (`--reasoning-budget -1`); `MAX_THINKING_TOKENS=0` in `qwen-code` does *not*
  change that — it governs Anthropic-style extended thinking, while Qwen's
  reasoning comes from its own chat template. The proxy emits real Anthropic
  `thinking` blocks (`THINK_VIEW=native`, the default `llm-serve` sets), so
  Claude Code renders the reasoning phase in its own UI rather than going quiet.
  The signature those blocks carry is Anthropic's proof the reasoning is
  unmodified; nothing validates it here, because the proxy *is* the server, and
  the harness only round-trips it back to us where it is dropped. Verified end
  to end. `THINK_VIEW=off|status|text` for no display, a compact heartbeat, or
  the full chain of thought inline.
- **One request at a time**, per `-np 1` above.
- **Prompt caching doesn't apply.** There's no cross-request discount to exploit
  like the Anthropic API has; llama-server does keep a local prefix cache, which
  is why repeated turns in one session prefill faster. `--cache-reuse 256`
  softens the all-or-nothing edge of that cache by shifting matching KV chunks
  rather than discarding everything past the first divergent token, but it does
  not survive a server restart — the cache is in RAM, and a `llm-serve restart`
  or `start <other-model>` starts cold.
- **`count_tokens` is approximated** (chars ÷ 3.5). It only drives compaction
  timing, so an approximation is fine.
- **Web search is best-effort.** The proxy stands in for Anthropic's server-side
  search (§7), but the default backend scrapes DuckDuckGo without an API key and
  can rate-limit. Set `SEARCH_BACKEND=brave` or `searxng` for something durable.
- **Server-side tools other than web search and fetch are dropped** — code
  execution and computer use have no local stand-in.
- **Cross-session prompt caching does not work**, for the structural reason in
  §10: the harness puts a static ~2.5k-token catalog *after* the varying user
  prompt, and the model's attention makes a partial-prefix restore impossible.
  Budget one full prefill per session; everything after that is cached.
- **The 27B is prefill-bound, not generation-bound.** ~20k tokens of harness
  prompt at ~275 tok/s on an unloaded machine is ~75 s before the first token.
  The 35B A3B MoE prefills the same prompt roughly 3x faster (measured 25 s vs
  77 s cold) — pick it when session start-up latency matters more than peak
  reasoning quality.
