# Developer Setup: Local Agentic & LLM Environment

An optimized, production-ready environment setup for macOS (Apple Silicon MacBook Pro M5 Pro 64GB) combining Claude Code, Google Antigravity CLI (`agy`), Kiro CLI (`kiro-cli`), and fast local coding LLMs (**Ornith-1.5-35B-A3B**, **Inkling-2-Mini**, **DaisyRose-27B** on **oMLX v0.8.1**, plus **Qwen 3.8 27B Splash** on LM Studio) with speculative decoding.

The local models are integrated into **Claude Code only**, and are strictly opt-in — a plain `claude` session has no access to them whatsoever. See [LOCAL_LLM_HARNESS.md](LOCAL_LLM_HARNESS.md) and the Nov 2026 9-arm benchmark report in **[WALKTHROUGH_2026_11.md](WALKTHROUGH_2026_11.md)**.

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
claude                                           # Pro subscription
claude open_router [ox_alpha|<model_id>]         # OpenRouter (default stealth/ox-alpha)
claude local ornith [--think xhigh|medium|low]   # Ornith-1.5-35B-A3B oQ4e-mtp on oMLX (default local)
claude local inkling2 [--think xhigh|...|none]   # Thinking Machines Inkling-2-Mini oQ3e-mtp on oMLX + DSpark
claude local daisyrose [--think xhigh|med|low]   # DaisyRose-27B pure-RL oQ4e-mtp on oMLX
claude local qwen38_27 [--think xhigh|med|low]   # Qwen 3.8 27B Splash 4-bit on LM Studio
claude local [--think ...]                       # resident local model (or starts ornith35)
claude subagent                                  # Pro + the opt-in local-qwen delegation subagent
```

`qwen38_27` uses LM Studio's Splash engine; `ornith`, `inkling2`, and `daisyrose` use `oMLX v0.8.1` (`--think xhigh` default everywhere).
`--think` accepts aliases (`high`/`max` = xhigh, `med` = medium, `minimal` = low; Inkling 2 Mini also accepts `none`/`minimal`/`high`). Every branch forwards `"$@"`, so `claude -p "..."` and `claude local ornith --resume` work.

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
llm-serve start [ornith35|inkling2|daisyrose27|splash4]
llm-serve stop | status | which | logs [server|proxy]
llm-serve restart [model]   # full restart (reloads weights)
llm-serve restart-proxy     # reload just the proxy, model stays resident
lmstudio-setup              # LM Studio app: search/files/memory tools + preset (§5.2)

qwen "explain this regex"   # one-shot prompt against the resident model
qwen-cli [model]            # interactive terminal chat (REPL for oMLX, lms chat for splash4)

# aliases
llm_start / llm_stop / llm_status / llm_logs
llm_use_ornith / llm_use_inkling2 / llm_use_daisyrose / llm_use_splash
claude_local_ornith / claude_local_inkling2 / claude_local_daisyrose / claude_local_splash
qwen_ornith_chat / qwen_inkling_chat / qwen_daisy_chat / qwen_splash_chat
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

## 5. Local LLM Setup (`oMLX` + LM Studio Splash)

Four verified local models are configured (see **[WALKTHROUGH_2026_11.md](WALKTHROUGH_2026_11.md)** for complete 9-arm benchmarks on M5 Pro 64 GB):

| CLI Flag (`claude local ...`) | `llm-serve` alias | Model & Engine | Warm Ping | Decode (2K / T2) | Coding Eval (`xhigh`) |
|---|---|---|---:|---:|---|
| `ornith` (default) | `ornith35` | `Ornith-1.5-35B-A3B-oQ4e-mtp` (`oMLX` + MTP) | **0.61 s** | **103.6 / 86.9 t/s** | **5/5 + T6 PASS** (11.6m) |
| `inkling2` | `inkling2` | `Inkling-2-Mini-oQ3e-mtp` (`oMLX` + DSpark, `TF32=0`) | 3.98 s | 65.8 / 30.2 t/s | **5/5 + T6 PASS** (65.9m) |
| `daisyrose` | `daisyrose27` | `DaisyRose-27B-oQ4e-mtp` (pure-RL Qwen 3.8, `oMLX` + MTP) | 1.76 s | 45.2 / 31.3 t/s | **5/5 + T6 PASS** (41.4m) |
| `qwen38_27` | `splash4` | `incoai/Qwen3.8-27B-Splash` (LM Studio Splash 1.3.0 + DFlash2) | 1.01 s | 73.7 / 44.3 t/s | 4/5 + T6 PASS (58.8m) |

Thinking defaults to `xhigh` everywhere (`LLM_EFFORT`, `--think`); `--think medium|low` (and `minimal|none` on Inkling 2) trades depth for latency.

The local models are wired into **Claude Code only**. agy cannot reach a local model
(it ignores `mcpServers` and takes no custom endpoint), and Kiro's MCP integration was
removed to keep the experiment confined to one harness. Full integration guide:
**[LOCAL_LLM_HARNESS.md](LOCAL_LLM_HARNESS.md)**.

```bash
llm-serve start ornith35           # load Ornith-1.5-35B-A3B + Anthropic proxy (or start inkling2/daisyrose27/splash4)
qwen "explain this regex"          # one-shot, from your shell or a Bash call
claude local ornith                # Claude Code running 100% on local weights
```

`WebSearch` works on the local stack too: the proxy runs it itself (keyless
DuckDuckGo by default). See [LOCAL_LLM_HARNESS.md §7](LOCAL_LLM_HARNESS.md).

### 5.1 Splash engine (LM Studio)

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
| Claude Code | `claude local qwen38_27` (or `claude_local_splash`) |
| Serve only | `llm-serve start splash4` (`llm_use_splash`) |
| One-shot CLI | `qwen "..."`, `qwen --think "..."` |
| Interactive terminal chat | `qwen-cli splash4` (`qwen_splash_chat`, wraps `lms chat`) |
| UI | the LM Studio app → Chat, with tools and the Local Assistant preset (§5.2) |

Measured here (M5 Pro 64 GB): warm follow-ups in 1–2 s, 97–99% prompt-cache hits,
35–84 t/s decode, and correct recall at 227,078 tokens of context (depth ladder,
2026-09-27).

Claude Code's system prompt plus tool definitions alone are **~23,000 tokens**, which
is why the full 262,144 window is served (`LLM_CTX` overrides). See
[LOCAL_LLM_HARNESS.md §4](LOCAL_LLM_HARNESS.md).

### 5.2 LM Studio app as an everyday assistant

`lmstudio-setup` (run by `setup.sh`; quit LM Studio first) turns the app's Chat into a
tool-using assistant on the same model:

| Capability | How | Asks before running? |
|---|---|---|
| Web + image search | plugin `danielsig/duckduckgo` (keyless) | no |
| Read web pages | plugin `danielsig/visit-website` | no |
| Run JavaScript (maths, dates, data) | built-in `lmstudio/js-code-sandbox` | yes |
| Chat with attached documents | built-in `lmstudio/rag-v1` | — |
| Files | MCP `filesystem`, limited to `~/LMStudioFiles` | reads no, writes yes |
| Memory across chats | MCP `memory` → `~/.local/share/lmstudio-mcp/memory.jsonl` | reads no, writes yes |

It also installs the **Local Assistant** preset (system prompt: search before answering
anything current, cite sources, get the date from the sandbox, use memory) and gives
the virtual model Qwen's recommended sampling (temp 1.0, top-k 20, top-p 0.95) and a
262,144 default context, which apply to API requests too.

In a chat: pick `local/qwen3.8-27b-splash` (or the already-loaded `qwen-local`), select
the Local Assistant preset, and turn the plugins and MCP servers on from the
integrations button under the message box. Config lives in `dotfiles/lmstudio/`; edit
it and rerun `lmstudio-setup`.

---

## 6. Emulators (PCSX2 / NFS Most Wanted)

A tuned PCSX2 setup for **Need for Speed: Most Wanted (Black Edition)** on Apple Silicon
— a full game-ready config, a working DualSense control layout, and the reasoning behind
the performance choices. See [emulators/README.md](emulators/README.md); the live config is
[emulators/PCSX2.ini](emulators/PCSX2.ini).

Restore on a machine:
```bash
mkdir -p "$HOME/Library/Application Support/PCSX2/inis"
cp emulators/PCSX2.ini "$HOME/Library/Application Support/PCSX2/inis/PCSX2.ini"
```
The `.ini` paths are relative, so it's safe to share. Details on the Rosetta/CPU
bottleneck, the QHD rendering config, and the PCSX2 SDL-binding gotchas are in that file.
