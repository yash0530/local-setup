---
trigger: always_on
description: "Keep local Antigravity/agent setup files (skills, rules, configs under ~/.gemini/config/) synced and pushed to the user's local-setup GitHub repo."
---

# Sync Local Setup Changes to `local-setup` Repo

Whenever creating, editing, or updating local Antigravity / agent setup files (such as skills, rules, or portable configs under `~/.gemini/config/`), keep them synced with the user's `local-setup` repository and push the changes to GitHub.

- **Local repository**: `~/Desktop/Programming/local-setup`
- **GitHub remote**: `https://github.com/yash0530/local-setup.git` (`origin`, branch `main`)
- **Directory mapping (copy convention)**:
  - `~/.gemini/config/skills/<name>/` → `antigravity/skills/<name>/`
  - `~/.gemini/config/rules/<name>.md` → `antigravity/rules/<name>.md`
  - (Other setup domains in the repo: `claude_plugins/` for `~/.claude/`, `dotfiles/` for settings/`zshrc_snippet`/`lmstudio`, `scripts/` for `~/.local/bin/`, `emulators/` for PCSX2.)
- **Sync hygiene**:
  1. Copy the new or updated portable file(s) into the matching path in `~/Desktop/Programming/local-setup` (and update `setup.sh` / `README.md` if adding a new install target).
  2. Never commit secrets, tokens, auth files, machine-local runtime state (`~/.gemini/config/config.json`, `projects/`, credentials), or unrelated dirty/untracked files already in the repo.
  3. Inspect `git status` and `git diff`, make a focused commit with a clear message, and push to `origin main`.
