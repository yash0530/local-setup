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

# Use cp -R to copy the plugins and skills directories
cp -R "$REPO_DIR/claude_plugins/plugins/"* "$CLAUDE_DIR/plugins/"
cp -R "$REPO_DIR/claude_plugins/skills/"* "$CLAUDE_DIR/skills/"
cp -R "$REPO_DIR/claude_plugins/commands/"* "$CLAUDE_DIR/commands/"

# 4. Copy the Auto-Resume Daemon script and install it via launchd
echo "Installing Claude Auto-Resume Daemon..."
cp "$REPO_DIR/scripts/claude_resume_daemon.py" "$CLAUDE_DIR/claude_resume_daemon.py"
cp "$REPO_DIR/scripts/claude_resume_daemon.README.md" "$CLAUDE_DIR/claude_resume_daemon.README.md"

# Run the daemon installation
python3 "$CLAUDE_DIR/claude_resume_daemon.py" install

# 5. Append zshrc snippet to ~/.zshrc
ZSHRC="$HOME/.zshrc"
if [ -f "$ZSHRC" ]; then
  echo "Appending productivity aliases to $ZSHRC..."
  if grep -q "serve_qwen_36_27b" "$ZSHRC"; then
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
