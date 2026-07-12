---
description: Control the Claude auto-resume daemon (start / stop / restart / status / logs)
argument-hint: "[start|stop|restart|status|logs]"
allowed-tools: Bash(launchctl:*), Bash(pgrep:*), Bash(tail:*), Bash(echo:*), Bash(id:*)
---

Control the Claude auto-resume daemon (launchd label `com.user.clauderesume`).

Requested action: **$ARGUMENTS** (if empty, default to `status`).

Run **only** the command(s) for that action with Bash, then report the result in 1–2 lines.

- **start** → `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.user.clauderesume.plist 2>/dev/null; launchctl kickstart gui/$(id -u)/com.user.clauderesume`
- **stop** → `launchctl bootout gui/$(id -u)/com.user.clauderesume`
- **restart** → `launchctl kickstart -k gui/$(id -u)/com.user.clauderesume`
- **status** (default) → `pgrep -fl claude_resume_daemon.py; launchctl list | grep clauderesume || echo "not loaded"`
- **logs** → `tail -n 20 ~/.claude/claude_resume_daemon.log`

After `start` / `stop` / `restart`, also run the **status** command and confirm the new state
(report the running PID, or "stopped" if no process). Don't run anything not listed above.
