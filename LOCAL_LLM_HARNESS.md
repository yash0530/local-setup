# Wiring local Qwen 3.6 into Claude Code, agy, and Kiro

How to use the two locally-served Qwen 3.6 models as working agents inside the
three CLI harnesses on this machine. Every number and command below was measured
or executed on this box (M5 Pro, 64 GB), not estimated.

---

## 0. What exists — the whole inventory

Six pieces were added. Nothing else changed, and **plain `claude` is untouched**.

| # | Thing | Type | What it's for |
|---|---|---|---|
| 1 | `llm-serve` | CLI | Start/stop/switch the model + proxy. Everything else assumes this is running. |
| 2 | `llm-proxy.mjs` | background service | Translates Anthropic ⇄ OpenAI so **Claude Code** can run on local weights. Started automatically by `llm-serve`. |
| 3 | `qwen` | CLI | One-shot prompt. **The universal path** — usable from all three harnesses' shell tools. |
| 4 | `qwen-code` | CLI wrapper | Launches Claude Code pinned to a local model. What the `claude_local_*` aliases call. |
| 5 | `mcp-local-llm.mjs` | MCP server | Exposes `ask_local_model` as a tool. **For Kiro.** |
| 6 | `local-qwen` | Claude Code subagent | Delegation target so local output stays out of the parent context. |

And what each harness actually got:

| Harness | What it got | How you use it |
|---|---|---|
| **Claude Code** | All of it — proxy, subagent, CLI | `claude_local_qwen_3.6_35`, or delegate to `local-qwen`, or just run `qwen` in Bash |
| **Kiro** | MCP tool + CLI | It calls `ask_local_model` on its own; already registered globally |
| **agy** | CLI only (no MCP — tested, unsupported) | Tell it to `run_command` → `qwen "..."` |

> **On the "MCP subagent" confusion:** these are two *different* things, for two
> different harnesses. The **MCP server** (#5) is for **Kiro**. The **subagent**
> (#6) is a Claude Code feature that shells out to `qwen` — no MCP involved.
> Claude Code never needed MCP here, because the proxy gives it something
> strictly better: the local model driving the real toolset.

### Everything here is opt-in

This setup is for **deliberate experimentation**. None of it should touch real
work done on the Claude Pro subscription unless explicitly asked for.

Every entry point that a model could invoke on its own — the `local-qwen`
subagent, the `local-llm` skill, and the `ask_local_model` MCP tool — is worded
to fire **only when the user names the local model in the current request**
("ask qwen", "use the local model", "run this locally"). Each description states
explicitly that a task being bulky, repetitive, or cheaper to run locally is
*not* a reason to route it there.

Verified both directions on Kiro:

| Prompt | Result |
|---|---|
| "Summarize in one sentence what a semaphore is. **This is bulk text work.**" | answered directly — **no tool call** |
| "**Ask the local model:** what is a semaphore in one sentence?" | called `ask_local_model` |

The user-driven entry points (`qwen`, `qwen-code`, `claude_local_*`) are inert
until you run them, and plain `claude` never routes anywhere but Anthropic.

> **These are strong heuristics, not hard enforcement.** Tool and agent
> descriptions steer model selection; they don't forbid it. For a hard guarantee
> during sensitive work: `kiro-cli mcp add --name local-llm --scope global
> --command node --args ~/.local/bin/mcp-local-llm.mjs --disabled --force`
> switches Kiro's tool off entirely, and moving `~/.claude/agents/local-qwen.md`
> aside removes the subagent from Claude Code.

---

## 1. The core problem, and the three ways around it

`llama-server` speaks the **OpenAI** chat-completions API. The harnesses don't
all want that:

| Harness | Talks | Can it point at a local endpoint? | Integration that works |
|---|---|---|---|
| **Claude Code** | Anthropic Messages API | Yes — `ANTHROPIC_BASE_URL` | **Translation proxy** (full agent loop) + CLI + subagent |
| **Kiro** (`kiro-cli`) | Fixed cloud model list | No | **MCP tool** + CLI |
| **Antigravity** (`agy`) | Fixed cloud model list | No | **CLI only** (via its `run_command` tool) |

So there are three integration paths, in descending order of power:

**A. Base-URL swap (Claude Code only).** A ~400-line shim translates Anthropic
Messages ⇄ OpenAI, so Claude Code's *entire* toolset — Read, Edit, Write, Bash,
Grep, subagents — runs on local weights. This is the only path that gives a
local model real agency.

**B. MCP tool (Kiro, Claude Code).** The cloud model stays in the driver's seat
and calls the local model as a tool for bulk text work.

**C. Shell CLI (universal).** Every harness has a shell tool, so a plain `qwen`
command works everywhere with zero harness support. This is the workhorse.

> **agy caveat:** Antigravity ignores an `mcpServers` block in
> `~/.gemini/antigravity-cli/settings.json` — this was tested directly, and the
> tool never appears in its tool list. Its 17 built-in tools are fixed. It
> reaches the local model only through `run_command` calling `qwen`.

```
                 ┌─────────────────────────────────────────┐
                 │   llama-server  :8089  (OpenAI API)      │
                 │   one Qwen 3.6 GGUF resident at a time   │
                 └─────────────────────────────────────────┘
                     ▲              ▲                ▲
        OpenAI HTTP  │              │ stdio (MCP)    │ HTTP
                     │              │                │
        ┌────────────┴───┐  ┌───────┴────────┐  ┌────┴──────────┐
        │  llm-proxy     │  │ mcp-local-llm  │  │  qwen  (CLI)  │
        │  :8790         │  │                │  │               │
        │  Anthropic API │  │  MCP server    │  │  one-shot      │
        └────────┬───────┘  └───────┬────────┘  └────┬──────────┘
                 │                  │                │
          ANTHROPIC_BASE_URL   kiro-cli mcp     Bash / run_command /
                 │                  │           execute_bash
          ┌──────┴──────┐    ┌──────┴──────┐    ┌───┴──────────────┐
          │ qwen-code   │    │   Kiro      │    │ all three CLIs   │
          │ (Claude Code│    │             │    │                  │
          │  on Qwen)   │    │             │    │                  │
          └─────────────┘    └─────────────┘    └──────────────────┘
```

---

## 2. Quick start

```bash
llm-serve start            # loads 35B A3B + proxy (~7 s warm, ~40 s cold)
llm-serve status           # what's resident, and is it healthy

qwen "explain this regex: ^\d{3}-\d{4}$"        # one-shot, ~1 s
git diff | qwen "write a conventional-commit message"

claude_local_qwen_3.6_35   # interactive Claude Code, 100% local
claude_local_qwen_3.6_27   # same, on the 27B dense model

llm-serve stop             # frees ~36 GB
```

`claude` on its own is untouched and still uses your **Claude Pro subscription**.
No Anthropic env vars are exported globally — they are scoped inside the
`qwen-code` process only. (See §7 if you ever see local traffic leak.)

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

**Default to 35B A3B.** It is ~3.8x faster to decode and ~3.3x faster to prefill.
For an agent loop — which is many round-trips of a large prompt — that gap is the
difference between usable and unusable. Reach for the 27B only when a single
answer's quality justifies waiting roughly 4x longer.

Only one fits in 64 GB at Q8, so `llm-serve start <model>` **replaces** the
resident one (verified: 35b→27b switches cleanly, and the proxy survives it
because it is model-agnostic).

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
  -ctk q8_0 -ctv q8_0 \
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

### 5.3 Kiro — MCP tool

Registered globally (`~/.kiro/settings/mcp.json`):

```bash
kiro-cli mcp add --name local-llm --scope global \
  --command node --args ~/.local/bin/mcp-local-llm.mjs --force
```

Kiro's cloud model then calls `ask_local_model` itself. Verified working — a
round-trip completed in **1.96 s**.

### 5.4 agy — CLI only

No MCP, no custom endpoint. Just tell it to shell out:

```bash
agy -p "Run: qwen -f src/parser.ts 'summarise this in 5 bullets' — then act on the summary."
```

---

## 6. Thinking, and the dead-connection failure it causes

Both models are reasoning models and, left alone, spend **~4,000–5,500 tokens
thinking** before answering. Thinking is left **on** in the agent path — it is
where these models' quality comes from — but it has a sharp operational edge.

### The failure

Firing up `claude_local_qwen_3.6_27` produced:

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
- **Bulk path (`qwen` CLI, MCP tool):** thinking **off** by default, since
  summarising and drafting gain nothing from it. `--think` opts in per call.

```bash
qwen "summarise this log" -f app.log                    # off — bulk work
qwen --think "why would this deadlock?" -f worker.go    # on — real analysis
```

> `MAX_THINKING_TOKENS=0` in `qwen-code` controls the **harness**, not the model
> — it stops Claude Code requesting Anthropic-style thinking blocks it can't get.
> The local model still reasons normally.

---

## 7. Concurrency: why not vLLM?

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

## 8. What to actually send local

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

## 9. Troubleshooting

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

---

## 10. What's installed where

| Path | What |
|---|---|
| `~/.local/bin/llm-serve` | start/stop/switch/status for the whole stack |
| `~/.local/bin/llm-proxy.mjs` | Anthropic ⇄ OpenAI translation shim (port 8790) |
| `~/.local/bin/qwen` | one-shot CLI — the universal integration |
| `~/.local/bin/qwen-code` | Claude Code pinned to a local model |
| `~/.local/bin/mcp-local-llm.mjs` | MCP server exposing `ask_local_model` |
| `~/.claude/agents/local-qwen.md` | Claude Code delegation subagent |
| `~/.claude/skills/local-llm/SKILL.md` | routing guidance for Claude |
| `~/.kiro/settings/mcp.json` | Kiro's MCP registration |
| `~/.local/state/local-llm/` | pidfiles, `current`, logs |

All of it is reproducible on a new machine with `./setup.sh` from this repo.

---

## 11. Known limits

- **Text only.** Neither model has vision; the proxy replaces image blocks with
  a note rather than failing.
- **Thinking blocks are dropped, not forwarded.** Anthropic `thinking` blocks
  carry a signature the harness round-trips on the next turn, and a local model
  can't produce a valid one — emitting them risks 400s on multi-turn
  conversations. The model still reasons internally; set `EMIT_THINKING=1` on
  the proxy to see it as plain text.
- **One request at a time**, per `-np 1` above.
- **Prompt caching doesn't apply.** There's no cross-request discount to exploit
  like the Anthropic API has; llama-server does keep a local prefix cache, which
  is why repeated turns in one session prefill faster.
- **`count_tokens` is approximated** (chars ÷ 3.5). It only drives compaction
  timing, so an approximation is fine.
