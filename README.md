# Developer Setup: Local Agentic & LLM Environment

An optimized, production-ready environment setup for macOS (Apple Silicon MacBook Pro M5 Pro 64GB) combining Claude Code, Google Antigravity CLI (`agy`), Kiro CLI (`kiro-cli`), and local Llama models with speculative decoding (MTP).

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
- Copy and activate the **Claude Auto-Resume Daemon** (`launchd`).
- Append aliases to your `~/.zshrc`.

To run it:
```bash
chmod +x setup.sh
./setup.sh
source ~/.zshrc
```

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
alias claude_resume="python3 ~/.claude/claude_resume_daemon.py"
alias claude_resume_logs="tail -f ~/.claude/claude_resume_daemon.log"
```

---

## 4. Claude Auto-Resume Daemon

The auto-resume daemon runs silently in the background via `launchd` (`com.user.clauderesume`). 
- **Detection**: It reads the active sessions' transcripts (`~/.claude/projects/*/<sessionId>.jsonl`) and detects structured rate-limit errors (`error:"rate_limit"`, `apiErrorStatus:429`).
- **Resuming**: It sends `continue` to the active session's terminal window/pane (supports Terminal.app, iTerm2, and tmux) when the rate limit window resets.
- **Controls**:
  ```bash
  # Check status
  claude_resume status
  # Restart daemon
  launchctl kickstart -k gui/$(id -u)/com.user.clauderesume
  ```

---

## 5. Local LLM Setup (Qwen 3.6 27B & 35B MoE)

Based on benchmark evaluations, the fastest served versions are the **8-bit quantized GGUF models** running speculative decoding (MTP) on **`llama.cpp`** (`llama-server`).

### 5.1 Serving Parameters & Launch Commands

We use `llama-server` from Homebrew:
```bash
brew install llama.cpp
```

#### 🥇 Model 1: Qwen 3.6 27B (Dense) — 8-bit Quant (Q8_0) + MTP
- **Best speculative draft depth**: `draft-n=2` (Acceptance rate: **68%**).
- **Performance**: Peak **17.7 tok/s** decode (1.80x speedup vs MTP off).
- **Launch Command (`serve_qwen_36_27b`)**:
  ```bash
  llama-server -m ~/Models/qwen3.6-27b-mtp-q8/Qwen3.6-27B-Q8_0.gguf \
    --spec-type draft-mtp --spec-draft-n-max 2 \
    -c 16384 -ngl 99 -fa on -np 1 --jinja --reasoning-format deepseek \
    --temp 0.6 --top-p 0.95 --top-k 20 --host 127.0.0.1 --port 8089
  ```

#### 🥈 Model 2: Qwen 3.6 35B A3B (MoE) — 8-bit Quant (Q8_0) + MTP
- **Best speculative draft depth**: `draft-n=1` (Acceptance rate: **78%**).
- **Performance**: Peak **67.2 tok/s** decode (1.21x speedup vs MTP off).
- **Launch Command (`serve_qwen_36_35b`)**:
  ```bash
  llama-server -m ~/Models/qwen3.6-35b-a3b-mtp-q8/Qwen3.6-35B-A3B-Q8_0.gguf \
    --spec-type draft-mtp --spec-draft-n-max 1 \
    -c 16384 -ngl 99 -fa on -np 1 --jinja --reasoning-format deepseek \
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
