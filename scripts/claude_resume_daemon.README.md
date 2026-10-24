# Claude Auto-Resume Daemon

Auto-types `continue` into a rate-limited Claude Code session **once its limit resets**, so
long/AFK runs pick themselves back up. Runs in the background via launchd; survives reboot.

## How it works (the important part)
- **Detection is structured, not screen-scraping.** It reads each live session's transcript
  (`~/.claude/projects/*/<sessionId>.jsonl`) and treats a session as blocked **only** when its
  latest assistant turn carries Claude Code's own flags: `error:"rate_limit"` /
  `apiErrorStatus:429` / `isApiErrorMessage:true`. Conversation that merely *mentions* limits
  can never trigger it (that was the old bug).
- **Transcript-authoritative:** Detection checks the latest assistant turn in the transcript
  for rate-limit errors or rejected quota status. Even if a session retains `status: "busy"`
  due to subagents or background tasks, it will still be properly detected and resumed.
- **Structured and timezone-aware reset:** Reads machine-precise epoch from `quotaLimits.resetsAt`
  when available, or parses clock and relative reset banners (`resets 4:30pm (America/Los_Angeles)`,
  `resets in 15 minutes`) anchored to when the limit was hit. Adds a 15s grace buffer to ensure
  the quota window has fully opened before nudging.
- **Process ancestor resolution:** Traverses the process hierarchy to map internal ptys (e.g. from shell wrappers or `kiro-cli-term`) back to the parent terminal emulator window/tab, ensuring AppleScript commands target valid tabs without freezing or erroring.
- **Waits, then nudges:** at/after the reset it sends `continue` to the session's terminal
  (Terminal.app / iTerm2 / tmux), and posts a macOS notification.
- **Persistent escalating retry (the 2026-10-24 fix):** if a send *fails* (tab wedged,
  terminal closed, Apple Event unresponsive), it retries with escalating backoff
  (`RETRY_DELAYS_SECONDS`: 1m → 3m → 5m → 15m → 30m, held at 30m) until the transcript
  confirms recovery or the session disappears. Previously 3 consecutive failures meant the
  daemon gave up **permanently** (`logged_max`) and a transient failure during unattended
  time turned into hours of dead air. The retry is still bounded (`RETRY_MAX_ATTEMPTS=20`,
  ~7.75h ceiling) so a permanently-detached terminal can't be AppleScript-flooded; hitting the
  ceiling pauses for 1h, after which it retries if the session still reads blocked.
- **Diagnosable failures:** send results are logged verbatim (`app_not_running`,
  `tab_not_found`, `timeout`, or the actual AppleScript error) — no more bare `error`.
- **Confirms via the transcript:** once a normal assistant reply appears, it logs `[RESOLVED]`.

Config constants are at the top of `claude_resume_daemon.py`:
`CHECK_INTERVAL_SECONDS=30`, `GRACE_SECONDS=15`, `RETRY_DELAYS_SECONDS`, `RETRY_MAX_ATTEMPTS`.

## Use it
It's already installed and running under launchd (label `com.user.clauderesume`). Nothing to do
day-to-day — leave your Claude Code tabs open; blocked ones resume themselves after reset.

Run it globally from your terminal: `claude-resume [start|stop|restart|status|logs|install|uninstall]`

```bash
# check status
claude-resume status

# view logs
claude-resume logs

# stop the daemon
claude-resume stop

# start it back up
claude-resume start

# restart it (e.g. after updating the script)
claude-resume restart

# fully install / uninstall the launchd plist
claude-resume install
claude-resume uninstall
```

## Log lines you'll see
- `[DETECTED] Session abc12345 … is rate-limit blocked; will resume after 2026-06-13 16:30 PDT`
- `[ACTION]  Reset window elapsed — resuming … Attempt 1...`
- `[ERROR]   Failed to send resume to /dev/ttys003 (terminal). Result: app_not_running. Retrying in 60s (attempt 1).`
- `[GIVE UP] 20 attempts on abc12345 without success. Pausing; will resume if the limit state changes.`
- `[RESOLVED] Session abc12345 is no longer rate-limited`

## Test it without waiting for a real limit
```bash
python3 - <<'PY'
import claude_resume_daemon as d, os, json
proj=os.path.expanduser("~/.claude/projects/-Users-yash-Desktop-Programming-ResearchEngine")
tid="zztest-"+os.urandom(3).hex(); p=os.path.join(proj,tid+".jsonl")
open(p,"w").write(json.dumps({"type":"assistant","timestamp":"2026-06-13T22:35:09Z",
  "isApiErrorMessage":True,"error":"rate_limit","apiErrorStatus":429,
  "message":{"role":"assistant","content":[{"type":"text","text":"You've hit your session limit · resets 4:30pm (America/Los_Angeles)"}]}})+"\n")
print(d.check_session_rate_limited({"sessionId":tid}))   # -> (True, <reset datetime>)
os.remove(p)
PY
```

## Caveats
- It can only send `continue` to **Terminal.app, iTerm2, or tmux** sessions (osascript/tmux).
- A **sleeping Mac** won't poll; it resumes on the next 30s tick after wake.
- Anthropic may ship a native "continue after the limit resets" option
  (claude-code issues #26775 / #35744 / #36320). If/when it lands, this daemon is redundant —
  prefer the native one then.
