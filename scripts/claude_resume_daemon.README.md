# Claude Auto-Resume Daemon

Auto-types `continue` into a rate-limited Claude Code session **once its limit resets**, so
long/AFK runs pick themselves back up. Runs in the background via launchd; survives reboot.

## How it works (the important part)
- **Detection is structured, not screen-scraping.** It reads each live session's transcript
  (`~/.claude/projects/*/<sessionId>.jsonl`) and treats a session as blocked **only** when its
  latest assistant turn carries Claude Code's own flags: `error:"rate_limit"` /
  `apiErrorStatus:429` / `isApiErrorMessage:true`. Conversation that merely *mentions* limits
  can never trigger it (that was the old bug).
- **Skips while you're working:** if the session status is `busy`, it does nothing.
- **Timezone-aware reset:** parses `resets 4:30pm (America/Los_Angeles)` using the banner's
  stated zone, anchored to when the limit was hit — correct even if this Mac's clock is on a
  different timezone (travel). If the reset time has already passed, it resumes immediately.
- **Waits, then nudges:** at/after the reset it sends `continue` to the session's terminal
  (Terminal.app / iTerm2 / tmux), up to 3 tries 10 min apart, and posts a macOS notification.
- **Confirms via the transcript:** once a normal assistant reply appears, it logs `[RESOLVED]`.

Config constants are at the top of `claude_resume_daemon.py`:
`CHECK_INTERVAL_SECONDS=30`, `RETRY_INTERVAL_SECONDS=600`, `MAX_RETRIES=3`.

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
- `[ACTION]  Reset window elapsed — resuming … Attempt 1/3`
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
