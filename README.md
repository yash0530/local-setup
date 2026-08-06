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
- Append aliases to your `~/.zshrc`.

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

### 3.1 Dangerous Mode Bypass Aliases
Skip permission prompts when running Claude Code or Antigravity, letting the model execute tools autonomously:
```bash
alias claude="claude --dangerously-skip-permissions"
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

# Claude Code running entirely on local weights
claude_local_qwen_3.6_27   # Claude Code on Qwen 3.6 27B (dense, higher quality)
claude_local_qwen_3.6_35   # Claude Code on Qwen 3.6 35B A3B (MoE, ~4x faster)
claude_local               # Claude Code on whichever model is resident

# Claude Code on your Pro plan, PLUS the local-qwen delegation subagent
claude_local_subagent
```

**Local models never leak into real work.** Two independent guarantees:

| Command | Model driving | Local subagent available? |
|---|---|---|
| `claude` | Pro subscription | **No — not present in the session at all** |
| `claude_local_subagent` | Pro subscription | Yes, and only when you name it in the prompt |
| `claude_local_qwen_3.6_*` | Local Qwen | n/a — the whole session is local |

The `local-llm` plugin lives in `~/.claude/local-plugins/`, which Claude Code
does **not** read; `claude_local_subagent` loads it for one session via
`--plugin-dir`. And `ANTHROPIC_BASE_URL` is never exported globally — it is
scoped inside the `qwen-code` process — so plain `claude` always stays on your
Pro subscription.

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
> claude_local_qwen_3.6_35     # Claude Code running 100% on local weights
> ```
>
> Plain `claude` is unaffected and still uses your Claude Pro subscription.

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

#### 🥇 Model 1: Qwen 3.6 27B (Dense) — 8-bit Quant (Q8_0) + MTP
- **Best speculative draft depth**: `draft-n=2` (Acceptance rate: **68%**).
- **Performance**: Peak **17.7 tok/s** decode (1.80x speedup vs MTP off).
- **Launch Command (`serve_qwen_36_27b`)**:
  ```bash
  llama-server -m ~/Models/qwen3.6-27b-mtp-q8/Qwen3.6-27B-Q8_0.gguf \
    --spec-type draft-mtp --spec-draft-n-max 2 \
    -c 65536 -ngl 99 -fa on -np 1 -ctk q8_0 -ctv q8_0 --jinja --reasoning-format deepseek \
    --temp 0.6 --top-p 0.95 --top-k 20 --host 127.0.0.1 --port 8089
  ```

#### 🥈 Model 2: Qwen 3.6 35B A3B (MoE) — 8-bit Quant (Q8_0) + MTP
- **Best speculative draft depth**: `draft-n=1` (Acceptance rate: **78%**).
- **Performance**: Peak **67.2 tok/s** decode (1.21x speedup vs MTP off).
- **Launch Command (`serve_qwen_36_35b`)**:
  ```bash
  llama-server -m ~/Models/qwen3.6-35b-a3b-mtp-q8/Qwen3.6-35B-A3B-Q8_0.gguf \
    --spec-type draft-mtp --spec-draft-n-max 1 \
    -c 65536 -ngl 99 -fa on -np 1 -ctk q8_0 -ctv q8_0 --jinja --reasoning-format deepseek \
    --temp 0.6 --top-p 0.95 --top-k 20 --host 127.0.0.1 --port 8089
  ```

### 5.2 Model Downloads
Download the 8-bit quantized models from Hugging Face:
```bash
# Qwen 3.6 27B GGUF
huggingface-cli download unsloth/Qwen3.6-27B-MTP-GGUF Qwen3.6-27B-Q8_0.gguf --local-dir ~/Models/qwen3.6-27b-mtp-q8

# Qwen 3.6 35B A3B GGUF
huggingface-cli download unsloth/Qwen3.6-35B-A3B-MTP-GGUF Qwen3.6-35B-A3B-Q8_0.gguf --local-dir ~/Models/qwen3.6-35b-a3b-mtp-q8
```
