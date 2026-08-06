#!/usr/bin/env bash
# setup.sh — Automated installer for the Claude Code, AGY, Kiro, and Llama setup.

set -euo pipefail

CLAUDE_DIR="$HOME/.claude"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="$HOME/.claude_backup_$(date +%Y%m%d_%H%M%S)"

echo "=== Starting Setup ==="

# 1. Back up existing ~/.claude configuration
if [ -d "$CLAUDE_DIR" ]; then
  echo "Backing up existing $CLAUDE_DIR to $BACKUP_DIR..."
  mkdir -p "$BACKUP_DIR"
  cp -R "$CLAUDE_DIR/" "$BACKUP_DIR/"
fi

# 2. Re-create base Claude directories
echo "Creating Claude Code directories..."
mkdir -p "$CLAUDE_DIR/plugins" \
         "$CLAUDE_DIR/skills" \
         "$CLAUDE_DIR/commands" \
         "$CLAUDE_DIR/sessions" \
         "$CLAUDE_DIR/projects"

# 3. Copy settings, plugins, skills, and commands
echo "Installing settings, plugins, skills, and commands..."
cp "$REPO_DIR/dotfiles/settings.json" "$CLAUDE_DIR/settings.json"

# Use cp -R to copy the plugins, skills, and commands directories safely if they are not empty
# NOTE: local-llm is skipped here on purpose. Copying it into ~/.claude/plugins
# would make the local-qwen subagent active in every plain `claude` session,
# which is exactly what this setup must not do. It is staged separately below.
if [ -d "$REPO_DIR/claude_plugins/plugins" ] && [ "$(ls -A "$REPO_DIR/claude_plugins/plugins")" ]; then
  for plugin in "$REPO_DIR/claude_plugins/plugins/"*; do
    [ -d "$plugin" ] || continue
    [ "$(basename "$plugin")" = "local-llm" ] && continue
    cp -R "$plugin" "$CLAUDE_DIR/plugins/"
  done
fi
if [ -d "$REPO_DIR/claude_plugins/skills" ] && [ "$(ls -A "$REPO_DIR/claude_plugins/skills")" ]; then
  cp -R "$REPO_DIR/claude_plugins/skills/"* "$CLAUDE_DIR/skills/"
fi
if [ -d "$REPO_DIR/claude_plugins/commands" ] && [ "$(ls -A "$REPO_DIR/claude_plugins/commands")" ]; then
  cp -R "$REPO_DIR/claude_plugins/commands/"* "$CLAUDE_DIR/commands/"
fi
# The local-llm plugin (local-qwen subagent + local-llm skill) is installed to a
# staging directory, NOT to ~/.claude. Nothing there is active in a plain
# `claude` session; `claude_local_subagent` loads it per-session via
# --plugin-dir. This is what keeps local models out of real Pro-plan work.
if [ -d "$REPO_DIR/claude_plugins/plugins/local-llm" ]; then
  echo "Installing opt-in local-llm plugin (not active in plain \`claude\`)..."
  mkdir -p "$CLAUDE_DIR/local-plugins"
  rm -rf "$CLAUDE_DIR/local-plugins/local-llm"
  cp -R "$REPO_DIR/claude_plugins/plugins/local-llm" "$CLAUDE_DIR/local-plugins/"
fi

# 4. Copy the Auto-Resume Daemon script, install CLI, and configure via launchd
echo "Installing Claude Auto-Resume Daemon..."
cp "$REPO_DIR/scripts/claude_resume_daemon.py" "$CLAUDE_DIR/claude_resume_daemon.py"
cp "$REPO_DIR/scripts/claude_resume_daemon.README.md" "$CLAUDE_DIR/claude_resume_daemon.README.md"

# Install global cli wrapper
echo "Installing claude-resume command..."
mkdir -p "$HOME/.local/bin"
cp "$REPO_DIR/scripts/claude-resume" "$HOME/.local/bin/claude-resume"
chmod +x "$HOME/.local/bin/claude-resume"

# Run the daemon installation
python3 "$CLAUDE_DIR/claude_resume_daemon.py" install

# 5. Install the local-LLM stack (llama-server manager, proxy, CLIs)
echo "Installing local LLM tooling to $HOME/.local/bin..."
mkdir -p "$HOME/.local/bin"
for tool in llm-serve llm-proxy.mjs qwen qwen-code claude-local-subagent; do
  cp "$REPO_DIR/scripts/$tool" "$HOME/.local/bin/$tool"
  chmod +x "$HOME/.local/bin/$tool"
done
echo "  installed: llm-serve, qwen, qwen-code, claude-local-subagent (+ llm-proxy)"

# 6. Append zshrc snippet to ~/.zshrc
ZSHRC="$HOME/.zshrc"
if [ -f "$ZSHRC" ]; then
  echo "Appending productivity aliases to $ZSHRC..."
  if grep -q "claude_local_qwen" "$ZSHRC"; then
    echo "Aliases already present in $ZSHRC. Skipping append."
  else
    echo -e "\n# --- Added by local-setup installer ---" >> "$ZSHRC"
    cat "$REPO_DIR/dotfiles/zshrc_snippet" >> "$ZSHRC"
    echo "# --------------------------------------" >> "$ZSHRC"
  fi
else
  echo "Warning: ~/.zshrc not found. Snippet is located at $REPO_DIR/dotfiles/zshrc_snippet"
fi

echo "=== Setup Complete! ==="
echo "Please reload your shell context by running:"
echo "    source ~/.zshrc"
echo "======================="
