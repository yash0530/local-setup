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

`setup.sh` configures everything. It will:
- Back up your existing `~/.claude/` configuration.
- Install the custom Claude plugins: `agy` (Antigravity) and `kiro` (Kiro CLI).
- Copy `settings.json` (skips permission alerts and enables plugins) and
  `statusline-command.sh` (the status line `settings.json` points at).
- Symlink the **local LLM stack** (`llm-serve`, `llm-proxy.mjs`, `qwen`, `qwen-cli`,
  `qwen-code`, `openrouter-code`, `claude-local-subagent`) into `~/.local/bin`.
- Stage the opt-in `local-llm` plugin (the `local-qwen` subagent + skill) into
  `~/.claude/local-plugins/` — **not** active in a plain `claude` session.
- Install and activate the **Claude Auto-Resume Daemon** (`launchd`).
- Add `dotfiles/zshrc_snippet` to `~/.zshrc` between marker lines; a re-run
  replaces that block in place.

```bash
chmod +x setup.sh
./setup.sh
source ~/.zshrc
```

**Two notes for a fresh machine:**
- The status line needs `jq` (`brew install jq`). The installer warns if it's missing.
- `settings.json` enables `frontend-design` and `swift-lsp` from the built-in
  `claude-plugins-official` marketplace. Those are **not** vendored here —
  Claude Code fetches them on first run.

---

## 3. Shell Commands & Aliases

### 3.1 The `claude` dispatcher

`claude` is a shell **function** (an alias cannot take subcommands). Plain `claude`
runs `claude --dangerously-skip-permissions` on your Pro subscription.

```bash
claude                                       # Pro subscription
claude open_router [ox_alpha|<model_id>]     # OpenRouter (default stealth/ox-alpha)
claude local qwen38_27 [--bits 4|5|6|8] [--think xhigh|medium|low]
                                             # local Qwen 3.8 27B (default --bits 5, --think xhigh)
claude local [--think xhigh|medium|low]      # whichever local model is already resident
claude subagent                              # Pro + the opt-in local-qwen delegation subagent
```

`--bits 4` runs on LM Studio's Splash engine (errors if LM Studio isn't installed);
`--bits 5|6|8` run a GGUF on llama.cpp. `--think` also accepts `high`/`max` (= xhigh),
`med`, and `minimal` (= low). Every branch forwards `"$@"`, so
`claude -p "..."` and `claude local qwen38_27 --resume` work.

`agy` is a plain alias: `alias agy="agy --dangerously-skip-permissions"`.

### 3.2 Sleep Prevention
```bash
alias sleep_no="sudo pmset -a disablesleep 1"  # Disable sleep
alias sleep_ok="sudo pmset -a disablesleep 0"  # Enable sleep
```

### 3.3 Auto-Resume Daemon Controls
```bash
alias claude_resume="claude-resume"
alias claude_resume_logs="claude-resume logs"
```

### 3.4 Local LLM commands
```bash
llm-serve start [gguf5|gguf6|gguf8|splash4]   # default gguf5; start = switch
llm-serve stop | status | which | logs [server|proxy]
llm-serve restart [model]   # full restart (reloads weights)
llm-serve restart-proxy     # reload just the proxy, model stays resident

qwen "explain this regex"   # one-shot prompt against the resident model
qwen-cli [gguf5|gguf6|gguf8|splash4]   # interactive terminal chat

# aliases
llm_start / llm_stop / llm_status / llm_logs
llm_use_splash              # llm-serve start splash4
claude_local_splash         # qwen-code --model splash4
qwen_splash_chat            # qwen-cli splash4
```

**Local models never leak into real work:**

| Command | Model driving | Local subagent available? |
|---|---|---|
| `claude` | Pro subscription | **No — not present in the session at all** |
| `claude subagent` | Pro subscription | Yes, and only when you name it in the prompt |
| `claude local ...` | Local Qwen | n/a — the whole session is local |

The `local-llm` plugin lives in `~/.claude/local-plugins/`, which Claude Code does
**not** read; `claude subagent` loads it for one session via `--plugin-dir`.
`ANTHROPIC_BASE_URL` is never exported globally — it is scoped inside `qwen-code`.

### 3.5 OpenRouter (`claude open_router`)

Add your key to `~/.zshrc` and reload:
```bash
export OPENROUTER_API_KEY="sk-or-v1-your-key-here"
```

```bash
claude open_router ox_alpha                                  # interactive (1M context)
claude open_router ox_alpha -p "summarize the architecture"  # headless
claude open_router <model_id>                                # any OpenRouter model
claude_openrouter / claude_openrouter_ox_alpha / claude_ox_alpha   # aliases
```

`openrouter-code` scopes the OpenRouter credentials and `ANTHROPIC_BASE_URL` to its
own process, so plain `claude` stays on your Anthropic subscription.

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

## 5. Local LLM Setup (Qwen 3.8 27B)

One model, two engines:

| Alias | Engine | `--bits` | Notes |
|---|---|---|---|
| `splash4` | LM Studio Splash (4-bit + DFlash2 drafter) | 4 | fastest; best deep-context recall |
| `gguf5` | llama.cpp, UD-Q5_K_XL, MTP draft-n 2 | 5 | default |
| `gguf6` | llama.cpp, UD-Q6_K_XL, MTP draft-n 4 | 6 | |
| `gguf8` | llama.cpp, Q8_0, MTP draft-n 3 | 8 | at the memory edge; silent OOM near ~156k context |

Only one model is resident at a time; `llm-serve start <alias>` replaces it, and the
proxy survives the switch. Thinking defaults to `xhigh` everywhere (`LLM_EFFORT`,
`--think`); `--think medium|low` trades depth for latency.

The local models are wired into **Claude Code only**. agy cannot reach a local model
(it ignores `mcpServers` and takes no custom endpoint), and Kiro's MCP integration was
removed to keep the experiment confined to one harness. Full integration guide:
**[LOCAL_LLM_HARNESS.md](LOCAL_LLM_HARNESS.md)**.

```bash
llm-serve start splash4            # load the model + the Anthropic-translation proxy
qwen "explain this regex"          # one-shot, from your shell or a Bash call
claude local qwen38_27 --bits 4    # Claude Code running 100% on local weights
```

`WebSearch` works on the local stack too: the proxy runs it itself (keyless
DuckDuckGo by default). See [LOCAL_LLM_HARNESS.md §7](LOCAL_LLM_HARNESS.md).

### 5.0 Splash engine (LM Studio): `--bits 4`

[Splash](https://lmstudio.ai/blog/splash-engine) is Inco AI's Apple-Silicon engine
inside LM Studio, tuned for `incoai/Qwen3.8-27B-Splash` (4-bit only, its own weight
format plus a bundled DFlash2 drafter). It needs an M3 or newer, macOS 26.4+ and 36 GB+.

One-time install:

```bash
brew install --cask lm-studio && ~/.lmstudio/bin/lms bootstrap
lms runtime get splash
lms get https://huggingface.co/incoai/Qwen3.8-27B-Splash   # full URL: the bare name hits LM Studio Hub
```

`llm-serve start splash4` installs a small LM Studio virtual model
(`dotfiles/lmstudio/`) that exposes the template's `reasoning_effort`, so `--think`
reaches the model.

| | |
|---|---|
| Claude Code | `claude local qwen38_27 --bits 4` (or `claude_local_splash`) |
| Serve only | `llm-serve start splash4` (`llm_use_splash`) |
| One-shot CLI | `qwen "..."`, `qwen --think "..."` |
| Interactive terminal chat | `qwen-cli splash4` (`qwen_splash_chat`, wraps `lms chat`) |
| UI | the LM Studio app → Chat, with Qwen3.8-27B-Splash loaded |

Measured here (M5 Pro 64 GB): warm follow-ups in 1–2 s, 97–99% prompt-cache hits,
35–84 t/s decode, and correct recall at 198,609 tokens of context (depth ladder,
2026-09-27; gguf5's best was 158,766).

### 5.1 llama.cpp (`--bits 5|6|8`)

```bash
brew install llama.cpp
```

`llm-serve` launches, for `gguf5`:

```bash
llama-server -m ~/Models/qwen3.8-27b-gguf/Qwen3.8-27B-UD-Q5_K_XL.gguf \
  --spec-type draft-mtp --spec-draft-n-max 2 \
  -c 262144 -ngl 99 -fa on -np 1 --mlock \
  --cache-ram 24576 --slot-save-path ~/.local/state/local-llm/kv \
  --jinja --reasoning-format deepseek --reasoning-budget -1 \
  --temp 1.0 --top-p 0.95 --top-k 20 \
  -a qwen-local --host 127.0.0.1 --port 8089 --no-webui
```

- **`--mlock` is not optional.** Without it macOS evicts model pages under memory
  pressure and prefill collapses (measured 196 → 4 tok/s on an idle server).
  `LLM_MLOCK=0` opts out.
- **`--cache-ram 24576`** — a saved prompt state costs ~103 KB/token on this hybrid
  model, so llama.cpp's 8 GiB default silently drops warm restore past ~79k tokens.
- **`-np 1`** is required by MTP, so requests queue. vLLM is no better here: it is
  CUDA-first with no MTP for these GGUFs, so it is slower at concurrency 1.
- Claude Code's system prompt plus tool definitions alone are **~23,000 tokens**,
  which is why the full 262,144 window is served. See
  [LOCAL_LLM_HARNESS.md §4](LOCAL_LLM_HARNESS.md).

### 5.2 Model Downloads

```bash
# Splash: see §5.0.
# GGUFs (unsloth; the MTP head is inline, no separate drafter file)
huggingface-cli download unsloth/Qwen3.8-27B-GGUF Qwen3.8-27B-UD-Q5_K_XL.gguf --local-dir ~/Models/qwen3.8-27b-gguf
huggingface-cli download unsloth/Qwen3.8-27B-GGUF Qwen3.8-27B-UD-Q6_K_XL.gguf --local-dir ~/Models/qwen3.8-27b-gguf
huggingface-cli download unsloth/Qwen3.8-27B-GGUF Qwen3.8-27B-Q8_0.gguf       --local-dir ~/Models/qwen3.8-27b-gguf
```
