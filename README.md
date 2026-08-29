# Developer Setup: Local Agentic & LLM Environment

An optimized, production-ready environment setup for macOS (Apple Silicon MacBook Pro M5 Pro 64GB) combining Claude Code, Google Antigravity CLI (`agy`), Kiro CLI (`kiro-cli`), and local Llama models with speculative decoding (MTP).

The local models are integrated into **Claude Code only**, and are strictly opt-in — a plain `claude` session has no access to them whatsoever. See [LOCAL_LLM_HARNESS.md](LOCAL_LLM_HARNESS.md).

---

## 1. Prerequisites & Tool Installation

### 1.1 Node.js & Claude Code
Install Node.js (via Homebrew) and the official Anthropic Claude Code CLI:
```bash
brew install node
npm install -g @anthropic-ai/claude-code
```

### 1.2 Google Antigravity CLI (`agy`)
Ensure `agy` is installed to your local binaries path. If setting up a new laptop, copy the compiled binary to your local path:
```bash
mkdir -p ~/.local/bin
# Copy the agy binary to ~/.local/bin/agy and make it executable:
chmod +x ~/.local/bin/agy
```
Run `agy` once to complete authentication.

### 1.3 Kiro CLI (`kiro-cli`)
`kiro-cli` is a high-productivity CLI for delegating coding work. Copy `kiro-cli` to your local path:
```bash
# Copy the kiro-cli binary to ~/.local/bin/kiro-cli and make it executable:
chmod +x ~/.local/bin/kiro-cli
```
Run the login command interactively to authorize:
```bash
kiro-cli login
```

---

## 2. Fast Installation via `setup.sh`

This repository includes a `setup.sh` script to configure everything for you. It will:
- Back up your existing `~/.claude/` configuration.
- Install the custom Claude plugins: `agy` (Antigravity) and `kiro` (Kiro CLI).
- Copy `settings.json` (skips permission alerts and enables plugins).
- Install the **local LLM stack** (`llm-serve`, `qwen`, `qwen-code`,
  `claude-local-subagent`, and the Anthropic-translation proxy) into `~/.local/bin`.
- Stage the opt-in `local-llm` plugin (the `local-qwen` subagent + skill) into
  `~/.claude/local-plugins/` — **not** active in a plain `claude` session.
- Copy `statusline-command.sh` (the status line `settings.json` points at).
- Copy and activate the **Claude Auto-Resume Daemon** (`launchd`).
- Append the `claude` dispatcher function and the aliases to your `~/.zshrc`
  (skipped if the dispatcher is already defined there).

To run it:
```bash
chmod +x setup.sh
./setup.sh
source ~/.zshrc
```

**Two notes for a fresh machine:**
- The status line needs `jq` (`brew install jq`). The installer warns if it's missing.
- `settings.json` enables `frontend-design` and `swift-lsp` from the built-in
  `claude-plugins-official` marketplace. Those are **not** vendored in this repo —
  Claude Code fetches them on first run. Only `agy` (from `antigravity-cc`) and the
  opt-in `local-llm` plugin are vendored here.

---

## 3. Productive Shell Aliases

The installer appends the following aliases to your `~/.zshrc`. These bypass prompts, prevent Mac sleep during long runs, and handle background tasks:

### 3.1 The `claude` dispatcher

`claude` is a shell **function**, not an alias — an alias cannot take a
subcommand, and routing `claude local <model>` at the local stack needs one.
Plain `claude` behaves exactly as the old `alias claude="claude
--dangerously-skip-permissions"` did:

```bash
claude                       # Pro subscription, --dangerously-skip-permissions
claude open_router ox_alpha  # OpenRouter (Stealth Ox Alpha)
claude local qwen38_27       # local 27B dense
claude local qwen36_35       # local 35B A3B MoE
claude local                 # whichever model is already resident
claude subagent              # Pro + the opt-in local delegation subagent
```

Every branch forwards `"$@"`, so flags survive: `claude -p "..."`,
`claude local qwen36_35 --resume`. Inside the function, `command claude`
bypasses it, so it cannot recurse.

`agy` is still a plain alias:
```bash
alias agy="agy --dangerously-skip-permissions"
```

### 3.2 Sleep Prevention
Prevents your Mac from sleeping during long background coding runs, and allows re-enabling it afterwards:
```bash
alias sleep_no="sudo pmset -a disablesleep 1"  # Disable sleep
alias sleep_ok="sudo pmset -a disablesleep 0"  # Enable sleep
```

### 3.3 Auto-Resume Daemon Controls
```bash
alias claude_resume="claude-resume"
alias claude_resume_logs="claude-resume logs"
```

### 3.4 Local LLM Aliases
```bash
llm_start / llm_stop / llm_status / llm_logs   # manage the local stack
llm_use_27 / llm_use_35                        # switch resident model

# llm-serve subcommands with no alias
llm-serve which           # which model is resident
llm-serve restart         # full restart (reloads weights — slow)
llm-serve restart-proxy   # reload just the proxy, model stays resident
```

Claude Code on local weights goes through the §3.1 dispatcher:

```bash
claude local qwen38_27   # Qwen 3.8 27B (dense, higher quality)
claude local qwen36_35   # Qwen 3.6 35B A3B (MoE, ~4x faster)
claude local             # whichever model is resident
claude subagent          # Pro plan + the local-qwen delegation subagent
```

The older `claude_local_qwen_3.8_27` / `_3.6_35` / `claude_local` /
`claude_local_subagent` aliases are still defined and still work — they are what
the dispatcher branches call — but the `claude local ...` form is the one to
use.

**Local models never leak into real work.** Two independent guarantees:

| Command | Model driving | Local subagent available? |
|---|---|---|
| `claude` | Pro subscription | **No — not present in the session at all** |
| `claude subagent` | Pro subscription | Yes, and only when you name it in the prompt |
| `claude local ...` | Local Qwen | n/a — the whole session is local |

The `local-llm` plugin lives in `~/.claude/local-plugins/`, which Claude Code
does **not** read; `claude subagent` loads it for one session via
`--plugin-dir`. And `ANTHROPIC_BASE_URL` is never exported globally — it is
scoped inside the `qwen-code` process — so plain `claude` always stays on your
Pro subscription.

### 3.5 OpenRouter Cloud LLM Integration (`claude open_router`)

Claude Code can also connect to OpenRouter's Anthropic-compatible API gateway (such as `stealth/ox-alpha`).

#### 1. Add your OpenRouter API key to `~/.zshrc`
Add the `OPENROUTER_API_KEY` environment variable in your `~/.zshrc`:
```bash
export OPENROUTER_API_KEY="sk-or-v1-your-key-here"
```
Then reload your shell:
```bash
source ~/.zshrc
```

#### 2. Usage
```bash
# Interactive session with Ox Alpha (1M context window)
claude open_router ox_alpha

# Headless / one-shot execution
claude open_router ox_alpha -p "summarize the architecture"

# Any other OpenRouter model
claude open_router <model_id>

# Dedicated aliases
claude_openrouter_ox_alpha
claude_ox_alpha
```

The `openrouter-code` wrapper scopes the OpenRouter credentials and `ANTHROPIC_BASE_URL` strictly to that process, leaving plain `claude` completely on your official Anthropic subscription.

---

## 4. Claude Auto-Resume Daemon

The auto-resume daemon runs silently in the background via `launchd` (`com.user.clauderesume`). 
- **Detection**: It reads the active sessions' transcripts (`~/.claude/projects/*/<sessionId>.jsonl`) and detects structured rate-limit errors (`error:"rate_limit"`, `apiErrorStatus:429`).
- **Resuming**: It sends `continue` to the active session's terminal window/pane (supports Terminal.app, iTerm2, and tmux) when the rate limit window resets.
- **Controls**:
  ```bash
  # Check status
  claude-resume status
  # Restart daemon
  claude-resume restart
  ```

---

## 5. Local LLM Setup (Qwen 3.6 27B & 35B MoE)

Based on benchmark evaluations, the fastest served versions are the **8-bit quantized GGUF models** running speculative decoding (MTP) on **`llama.cpp`** (`llama-server`).

The local models are wired into **Claude Code only**. Kiro and agy were evaluated
and deliberately left out — agy cannot reach a local model at all (it ignores
`mcpServers` and takes no custom endpoint), and Kiro's MCP integration was removed
to keep the experiment confined to one harness.

**Why llama.cpp and not vLLM:** MTP requires a single slot (`-np 1`), so you get
concurrency *or* MTP — never both. vLLM is CUDA-first with no MTP support for
these GGUFs, which is why it benchmarks *slower* at concurrency 1 on Apple
Silicon. With one user at the keyboard, keep MTP and let requests queue.

> **Using these models *inside* Claude Code:** see
> **[LOCAL_LLM_HARNESS.md](LOCAL_LLM_HARNESS.md)** for the full integration guide.
> Short version — `setup.sh` installs `llm-serve`, `qwen`, and `qwen-code`:
>
> ```bash
> llm-serve start              # load 35B A3B + the Anthropic-translation proxy
> qwen "explain this regex"    # one-shot, from your shell or a Bash call
> claude local qwen36_35       # Claude Code running 100% on local weights
> ```
>
> Plain `claude` is unaffected and still uses your Claude Pro subscription.
>
> `WebSearch`/`WebFetch` work on the local stack too — they are Anthropic
> *server-side* tools, so the proxy executes them itself rather than letting the
> model call into a void. Keyless by default; see
> [LOCAL_LLM_HARNESS.md §7](LOCAL_LLM_HARNESS.md).

### 5.1 Serving Parameters & Launch Commands

We use `llama-server` from Homebrew:
```bash
brew install llama.cpp
```

The launch lines below use `-c 65536`. For harness use `llm-serve` goes further
and serves the model's full native **262,144** window with a quantized KV cache
(`-ctk/-ctv q8_0`) — measured at only **+1.4 GB** over 65k, because these Qwen
MoE models use very few KV heads. That headroom matters: Claude Code's system
prompt plus tool definitions alone measure **~23,000 tokens**. See
[LOCAL_LLM_HARNESS.md §4](LOCAL_LLM_HARNESS.md) for the caveat that deep context
is cheap to *allocate* but slow to *use*.

> **`--mlock` is not optional.** A 27–38 GB model on a 64 GB machine leaves
> little headroom, and macOS compresses or evicts model pages as soon as
> Spotlight and friends get busy. Generation barely notices; prefill sweeps every
> weight per batch and falls off a cliff — measured on an *idle* server at
> **196 → 4 tok/s**. Pinning the weights held 79 tok/s on the same run.
> `llm-serve` passes it by default (`LLM_MLOCK=0` opts out); the raw commands
> below need it spelled out.

#### 🥇 Model 1: Qwen 3.8 27B (Dense) — MLX, 8/6/4-bit + MTP
Replaced Qwen 3.6 27B on 2026-08-14, and moved from llama.cpp to **MLX** on 2026-08-15
after the quant sweep in `local_llm_bench`. MLX won every matched-size comparison and
matched llama.cpp's warm-cache TTFT, which is the metric that decided the 3.6 generation
the other way.

| Serving | Size | Decode @23k | Warm TTFT |
|---|---:|---:|---:|
| `mlx8` MLX 8-bit | 28 GB | 13.55 tok/s | 1.28 s |
| `mlx6` MLX 6-bit | 21 GB | **16.55 tok/s** | 1.28 s |
| `mlx4` MLX 4-bit | 15 GB | 19.78 tok/s | — |
| `27b` llama.cpp Q8_0 | 27 GB | 12.51 tok/s | 1.50 s |

`mlx8` is the default because it is closest to the reference and **quality below 8-bit is
not yet measured**. `mlx6` is ~24% faster per warm turn and 7 GB smaller if you want it.

```bash
llm-serve start mlx8                  # or mlx6 / mlx4
claude local qwen38_27 --bits 6       # Claude Code, pinned to the 6-bit build
claude local qwen38_27_gguf           # llama.cpp fallback
```

##### MLX serving gotchas

`mlx_vlm.server` differs from `llama-server` in five ways that each break serving. All are
handled by `llm-serve`; they are recorded here because every one of them fails quietly or
misleadingly, and anyone reproducing this by hand will hit them.

| Gotcha | Symptom |
|---|---|
| No `-a` model alias — the request's `model` field names something to *load* | `401` from Hugging Face looking for a repo called `qwen-local`; the proxy must send the model path |
| `--enable-thinking` is off by default | **Silent.** Template emits a pre-closed `<think></think>`, Qwen 3.8 answers with no reasoning, requests look fine |
| `chat_template_kwargs` is ignored | `PROXY_THINK` cannot control thinking; only the server flag decides |
| `--thinking-budget` + speculative decoding | `thinking_budget is not supported with speculative decoding in the server` |
| `APC_ENABLED` defaults to `"0"` upstream | **Silent.** Prompt caching off, so every turn re-prefills the whole preamble. `llm-serve` exports `1` (with `APC_EXACT_CACHE_ENTRIES=2` and `APC_SKIP_FULL_STORE=1`) since 2026-08-22 |

Quantized KV (`--kv-bits`) also breaks this architecture: since the 2026-08-22 runs it
silently truncates streaming tool-call responses (the stream ends without a
`finish_reason` chunk), so Claude Code turns end mid-flight. KV stays fp16.

Only the second and fifth produce plausible-looking output while being wrong, which makes
them the expensive ones: the model answers, just not the way it is supposed to.

Speculation is a separate 8-bit drafter checkpoint rather than a head inside the weights.
That is why MLX holds ~48% acceptance at every target size while llama.cpp's inline head
degrades as you quantize — its MTP speedup falls from 1.36x at Q8 to **0.87x at Q4**, i.e.
below Q8 you are faster with `LLM_SPEC=0`.

- **Launch Command (`serve_qwen_38_27b`, llama.cpp fallback)**:
  ```bash
  llama-server -m ~/Models/qwen3.8-27b-gguf/Qwen3.8-27B-Q8_0.gguf \
    --spec-type draft-mtp --spec-draft-n-max 3 \
    -c 65536 -ngl 99 -fa on -np 1 --mlock --jinja --reasoning-format deepseek \
    --temp 1.0 --top-p 0.95 --top-k 20 --host 127.0.0.1 --port 8089
  ```

#### 🥈 Model 2: Qwen 3.6 35B A3B (MoE) — 8-bit Quant (Q8_0) + MTP
- **Best speculative draft depth**: `draft-n=1` (Acceptance rate: **78%**).
- **Performance**: Peak **67.2 tok/s** decode (1.21x speedup vs MTP off).
- **Launch Command (`serve_qwen_36_35b`)**:
  ```bash
  llama-server -m ~/Models/qwen3.6-35b-a3b-mtp-q8/Qwen3.6-35B-A3B-Q8_0.gguf \
    --spec-type draft-mtp --spec-draft-n-max 1 \
    -c 65536 -ngl 99 -fa on -np 1 --mlock -ctk q8_0 -ctv q8_0 --jinja --reasoning-format deepseek \
    --temp 0.6 --top-p 0.95 --top-k 20 --host 127.0.0.1 --port 8089
  ```

`llm-serve` additionally passes `--cache-reuse 256` (salvages matching KV chunks
by shifting instead of all-or-nothing prefix matching) and `--slot-save-path`
(enables the `/slots` save/restore endpoints — inert until something calls
them). Neither is needed for one-shot raw use.

### 5.2 Model Downloads
Download the 8-bit quantized models from Hugging Face:
```bash
# Qwen 3.8 27B GGUF (MTP head is inline; no separate MTP repo for this generation)
huggingface-cli download unsloth/Qwen3.8-27B-GGUF Qwen3.8-27B-Q8_0.gguf --local-dir ~/Models/qwen3.8-27b-gguf

# Qwen 3.8 27B MLX (the default serving path) + its MTP drafter
huggingface-cli download mlx-community/Qwen3.8-27B-8bit --local-dir ~/Models/qwen3.8-27b-mlx-8bit
huggingface-cli download vvsotnikov/Qwen3.8-27B-MTP-MLX-8bit --local-dir ~/Models/qwen3.8-27b-mtp-mlx-8bit

# Qwen 3.6 35B A3B GGUF
huggingface-cli download unsloth/Qwen3.6-35B-A3B-MTP-GGUF Qwen3.6-35B-A3B-Q8_0.gguf --local-dir ~/Models/qwen3.6-35b-a3b-mtp-q8
```
