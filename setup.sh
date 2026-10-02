#!/usr/bin/env bash
# setup.sh — Automated installer for the Claude Code, AGY, Kiro, and local-LLM setup.

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

# settings.json's statusLine points at this script; install them together.
if [ -f "$REPO_DIR/dotfiles/statusline-command.sh" ]; then
  cp "$REPO_DIR/dotfiles/statusline-command.sh" "$CLAUDE_DIR/statusline-command.sh"
  chmod +x "$CLAUDE_DIR/statusline-command.sh"
  command -v jq >/dev/null 2>&1 || echo "  note: the status line needs \`jq\` — install it with 'brew install jq'"
fi

# local-llm is skipped on purpose: in ~/.claude/plugins it would be active in every
# plain `claude` session. It is staged separately below.
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
# Staged outside ~/.claude/plugins; `claude subagent` loads it per-session via --plugin-dir.
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
ln -sfn "$REPO_DIR/scripts/claude-resume" "$HOME/.local/bin/claude-resume"
chmod +x "$REPO_DIR/scripts/claude-resume"

# Run the daemon installation
python3 "$CLAUDE_DIR/claude_resume_daemon.py" install

# 5. Install the local-LLM stack (model-server manager, proxy, CLIs)
echo "Installing local LLM tooling to $HOME/.local/bin..."
mkdir -p "$HOME/.local/bin"
# Symlink rather than copy, so PATH can never run a stale script.
for tool in llm-serve llm-proxy.mjs qwen qwen-cli qwen-code openrouter-code claude-local-subagent lmstudio-setup; do
  ln -sfn "$REPO_DIR/scripts/$tool" "$HOME/.local/bin/$tool"
  chmod +x "$REPO_DIR/scripts/$tool"
done
echo "  installed: llm-serve, qwen, qwen-cli, qwen-code, openrouter-code, claude-local-subagent, lmstudio-setup (+ llm-proxy)"

# LM Studio app as an assistant: search/visit plugins, MCP servers, preset. Non-fatal:
# it needs LM Studio installed and quit.
if command -v lms >/dev/null 2>&1 || [ -x "$HOME/.lmstudio/bin/lms" ]; then
  "$REPO_DIR/scripts/lmstudio-setup" || echo "  skipped LM Studio setup — quit LM Studio and run: lmstudio-setup"
fi

# 6. Append zshrc snippet to ~/.zshrc
ZSHRC="$HOME/.zshrc"
if [ -f "$ZSHRC" ]; then
  echo "Appending productivity aliases to $ZSHRC..."
  # Replace an existing block rather than skipping it, so snippet edits reach installed shells.
  START="# --- Added by local-setup installer ---"
  END="# --------------------------------------"
  if grep -qF "$START" "$ZSHRC"; then
    echo "Updating existing local-setup block in $ZSHRC..."
    cp "$ZSHRC" "${ZSHRC}.bak-$(date +%Y%m%d-%H%M%S)"
    # Rewrite only between the markers; anything that must stay last (Kiro) is untouched.
    awk -v start="$START" -v end="$END" -v snip="$REPO_DIR/dotfiles/zshrc_snippet" '
      $0 == start { print; while ((getline line < snip) > 0) print line; skip = 1; next }
      $0 == end && skip { skip = 0 }
      !skip { print }
    ' "$ZSHRC" > "${ZSHRC}.tmp" && mv "${ZSHRC}.tmp" "$ZSHRC"
  else
    echo -e "\n$START" >> "$ZSHRC"
    cat "$REPO_DIR/dotfiles/zshrc_snippet" >> "$ZSHRC"
    echo "$END" >> "$ZSHRC"
  fi
else
  echo "Warning: ~/.zshrc not found. Snippet is located at $REPO_DIR/dotfiles/zshrc_snippet"
fi

echo "=== Setup Complete! ==="
echo "Please reload your shell context by running:"
echo "    source ~/.zshrc"
echo "======================="
