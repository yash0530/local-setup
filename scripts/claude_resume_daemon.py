#!/usr/bin/env python3
import os
import sys
import time
import json
import glob
import re
import subprocess
from datetime import datetime, timedelta, timezone
try:
    from zoneinfo import ZoneInfo
except Exception:
    ZoneInfo = None

# Configuration
CHECK_INTERVAL_SECONDS = 30
RETRY_INTERVAL_SECONDS = 600  # 10 minutes
MAX_RETRIES = 3

CLAUDE_DIR = os.path.expanduser("~/.claude")
CLAUDE_SESSIONS_DIR = os.path.join(CLAUDE_DIR, "sessions")
LOG_FILE = os.path.join(CLAUDE_DIR, "claude_resume_daemon.log")
PID_FILE = os.path.join(CLAUDE_DIR, "claude_resume_daemon.pid")
PLIST_PATH = os.path.expanduser("~/Library/LaunchAgents/com.user.clauderesume.plist")

# Tracking state, keyed by sessionId:
#   { "reset_at": datetime, "attempts": int, "tty": str|None, "logged_max": bool }
tracking_state = {}

def log(message):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    log_msg = f"[{timestamp}] {message}"
    print(log_msg)
    sys.stdout.flush()
    # Only append manually to LOG_FILE if stdout is NOT redirected.
    # If stdout is redirected (isatty is False), the redirection (via launchd or daemonize)
    # automatically writes stdout to the log file. Writing manually would duplicate logs.
    if sys.stdout.isatty():
        try:
            with open(LOG_FILE, "a") as f:
                f.write(log_msg + "\n")
        except Exception:
            pass

def get_active_sessions():
    """Finds active Claude sessions by inspecting files in ~/.claude/sessions/*.json."""
    sessions = []
    pattern = os.path.join(CLAUDE_SESSIONS_DIR, "*.json")
    for file_path in glob.glob(pattern):
        try:
            with open(file_path, 'r') as f:
                data = json.load(f)
            pid = data.get("pid")
            if pid:
                # Check if process is alive (kill -0)
                try:
                    os.kill(pid, 0)
                    sessions.append(data)
                except OSError:
                    pass
        except Exception:
            pass
    return sessions

def get_tty_for_pid(pid):
    """Gets the TTY name for a process PID."""
    try:
        output = subprocess.check_output(["ps", "-p", str(pid), "-o", "tty="], text=True).strip()
        if output and "?" not in output:
            if not output.startswith("/dev/"):
                return f"/dev/{output}"
            return output
    except Exception:
        pass
    return None

def get_terminal_app_contents(tty_path):
    """Retrieves contents of a Terminal.app tab matching tty_path."""
    script = f'''
    if application "Terminal" is running then
        tell application "Terminal"
            repeat with w in windows
                repeat with t in tabs of w
                    if tty of t is "{tty_path}" then
                        return history of t
                    end if
                end repeat
            end repeat
        end tell
    end if
    return ""
    '''
    try:
        return subprocess.check_output(["osascript", "-e", script], text=True).strip()
    except Exception:
        return ""

def send_terminal_app_enter(tty_path):
    """Sends 'continue' command to Terminal.app tab matching tty_path."""
    script = f'''
    if application "Terminal" is running then
        tell application "Terminal"
            repeat with w in windows
                repeat with t in tabs of w
                    if tty of t is "{tty_path}" then
                        do script "continue" in t
                        return "sent"
                    end if
                end repeat
            end repeat
        end tell
    end if
    return "not_found"
    '''
    try:
        return subprocess.check_output(["osascript", "-e", script], text=True).strip()
    except Exception:
        return "error"

def get_iterm_contents(tty_path):
    """Retrieves contents of an iTerm2 session matching tty_path."""
    tty_name = os.path.basename(tty_path)
    script = f'''
    if application "iTerm" is running then
        tell application "iTerm"
            repeat with w in windows
                repeat with t in tabs of w
                    repeat with s in sessions of t
                        set s_tty to tty of s
                        if s_tty is "{tty_path}" or s_tty is "{tty_name}" then
                            return text of s
                        end if
                    end repeat
                end repeat
            end repeat
        end tell
    end if
    return ""
    '''
    try:
        return subprocess.check_output(["osascript", "-e", script], text=True).strip()
    except Exception:
        return ""

def send_iterm_enter(tty_path):
    """Sends 'continue' command to iTerm2 session matching tty_path."""
    tty_name = os.path.basename(tty_path)
    script = f'''
    if application "iTerm" is running then
        tell application "iTerm"
            repeat with w in windows
                repeat with t in tabs of w
                    repeat with s in sessions of t
                        set s_tty to tty of s
                        if s_tty is "{tty_path}" or s_tty is "{tty_name}" then
                            tell s to write text "continue"
                            return "sent"
                        end if
                    end repeat
                end repeat
            end repeat
        end tell
    end if
    return "not_found"
    '''
    try:
        return subprocess.check_output(["osascript", "-e", script], text=True).strip()
    except Exception:
        return "error"

def get_tmux_contents(tty_path):
    """Gets text of tmux pane matching tty_path."""
    try:
        panes_output = subprocess.check_output(
            ["tmux", "list-panes", "-a", "-F", "#{pane_tty} #{session_name}:#{window_index}.#{pane_index}"],
            text=True
        ).strip().split('\n')
        
        for line in panes_output:
            parts = line.split(maxsplit=1)
            if len(parts) == 2:
                pane_tty, pane_id = parts
                if pane_tty == tty_path or os.path.basename(pane_tty) == os.path.basename(tty_path):
                    return subprocess.check_output(["tmux", "capture-pane", "-p", "-t", pane_id], text=True).strip()
    except Exception:
        pass
    return ""

def send_tmux_enter(tty_path):
    """Sends 'continue' command to tmux pane matching tty_path."""
    try:
        panes_output = subprocess.check_output(
            ["tmux", "list-panes", "-a", "-F", "#{pane_tty} #{session_name}:#{window_index}.#{pane_index}"],
            text=True
        ).strip().split('\n')
        
        for line in panes_output:
            parts = line.split(maxsplit=1)
            if len(parts) == 2:
                pane_tty, pane_id = parts
                if pane_tty == tty_path or os.path.basename(pane_tty) == os.path.basename(tty_path):
                    subprocess.check_call(["tmux", "send-keys", "-t", pane_id, "continue", "C-m"])
                    return "sent"
    except Exception:
        pass
    return "not_found"

def get_terminal_content(tty_path):
    """Queries Terminal.app, iTerm2, and tmux for contents matching tty_path."""
    # 1. Try tmux first (very fast, no UI AppleScript)
    content = get_tmux_contents(tty_path)
    if content:
        return content, "tmux"
        
    # 2. Try iTerm2
    content = get_iterm_contents(tty_path)
    if content:
        return content, "iterm"
        
    # 3. Try Terminal.app
    content = get_terminal_app_contents(tty_path)
    if content:
        return content, "terminal"
        
    return "", None

def send_enter(tty_path, terminal_type):
    """Sends enter key to the specified terminal type."""
    if terminal_type == "tmux":
        return send_tmux_enter(tty_path)
    elif terminal_type == "iterm":
        return send_iterm_enter(tty_path)
    elif terminal_type == "terminal":
        return send_terminal_app_enter(tty_path)
    return "unknown"

def notify(title, message):
    """Best-effort macOS notification (no-op if osascript is unavailable)."""
    try:
        subprocess.run(
            ["osascript", "-e", f"display notification {json.dumps(message)} with title {json.dumps(title)}"],
            check=False, timeout=5,
        )
    except Exception:
        pass

def _parse_iso(ts):
    """Parse a transcript ISO timestamp (e.g. '2026-06-13T22:35:09.389Z') to aware UTC, or None."""
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except Exception:
        return None

def parse_reset_time(text, hit_dt=None):
    """Reset instant of a limit banner as an aware UTC datetime, or None.

    Honors a timezone named in the banner — e.g. 'resets 4:30pm (America/Los_Angeles)' — and
    anchors to hit_dt (when the limit was actually hit, from the transcript) so the reset is the
    first occurrence of that clock at/after the hit. That keeps it correct regardless of the
    daemon machine's own timezone (handy when travelling) and across midnight, with no guesswork:
    if the computed instant is already past, the caller just sees now >= reset and resumes now."""
    if not text:
        return None
    m = re.search(r"(?:reset(?:s)?(?:\s+at)?|try again(?:\s+at)?)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?", text.lower())
    if not m:
        return None
    hour = int(m.group(1))
    minute = int(m.group(2) or 0)
    ampm = m.group(3)
    if ampm == "pm" and hour < 12:
        hour += 12
    elif ampm == "am" and hour == 12:
        hour = 0
    if hour > 23 or minute > 59:
        return None
    tz = None
    tzm = re.search(r"\(([A-Za-z]+/[A-Za-z_]+)\)", text)
    if tzm and ZoneInfo is not None:
        try:
            tz = ZoneInfo(tzm.group(1))
        except Exception:
            tz = None
    if tz is None:
        tz = datetime.now().astimezone().tzinfo  # fall back to the machine's local timezone
    anchor = hit_dt.astimezone(tz) if hit_dt else datetime.now(tz)
    candidate = anchor.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if candidate < anchor:
        candidate += timedelta(days=1)  # next occurrence of that clock at/after the hit
    return candidate.astimezone(timezone.utc)

def get_transcript_path(session):
    """Map a live session to its Claude Code transcript JSONL:
    ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl (matched by sessionId across project dirs)."""
    sid = session.get("sessionId")
    if not sid:
        return None
    matches = glob.glob(os.path.join(CLAUDE_DIR, "projects", "*", f"{sid}.jsonl"))
    return matches[0] if matches else None

def _tail_lines(path, max_lines=80, chunk=65536):
    """Read roughly the last `max_lines` lines of a (possibly large) file, efficiently."""
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            buf = b""
            while size > 0 and buf.count(b"\n") <= max_lines:
                step = min(chunk, size)
                size -= step
                f.seek(size)
                buf = f.read(step) + buf
        return buf.decode("utf-8", "replace").splitlines()[-max_lines:]
    except Exception:
        return []

def _recent_entries(path, max_lines=80):
    entries = []
    for line in _tail_lines(path, max_lines):
        line = line.strip()
        if not line:
            continue
        try:
            entries.append(json.loads(line))
        except Exception:
            pass
    return entries

def _entry_text(entry):
    msg = entry.get("message")
    if not isinstance(msg, dict):
        return ""
    content = msg.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(b.get("text", "") for b in content if isinstance(b, dict))
    return ""

def check_session_rate_limited(session):
    """Authoritative rate-limit check via Claude Code's STRUCTURED transcript — not the screen.

    A session is blocked iff its most recent assistant turn is a synthetic rate-limit error,
    identified by flags Claude Code itself writes on that entry:
        isApiErrorMessage == true  AND  (error == "rate_limit"  OR  apiErrorStatus == 429)
    Because those flags are machine-set, a conversation that merely *mentions* usage limits can
    never trigger detection — which is exactly what made the old screen-scraping detector misfire
    (it injected 'continue' while we were literally discussing limit banners). If the newest
    assistant turn is a real response instead, the session has already resumed.

    Returns (blocked: bool, reset_at: datetime|None) — reset_at parsed from the banner text.
    """
    path = get_transcript_path(session)
    if not path:
        return (False, None)
    for entry in reversed(_recent_entries(path)):
        if entry.get("type") != "assistant":
            continue  # skip user/system/tool rows; the latest *assistant* turn is the state
        is_limit = entry.get("isApiErrorMessage") is True and (
            entry.get("error") == "rate_limit" or entry.get("apiErrorStatus") == 429
        )
        if is_limit:
            return (True, parse_reset_time(_entry_text(entry), _parse_iso(entry.get("timestamp"))))
        return (False, None)  # newest assistant turn is a real response → not blocked
    return (False, None)

def check_already_running():
    """Checks if another instance of the daemon is already running."""
    if os.path.exists(PID_FILE):
        try:
            with open(PID_FILE, 'r') as f:
                pid = int(f.read().strip())
            if pid != os.getpid():
                os.kill(pid, 0)
                return pid
        except (ValueError, OSError):
            pass
    return None

def run_loop():
    """Main polling loop."""
    running_pid = check_already_running()
    if running_pid:
        sys.stderr.write(f"Error: Claude Auto-Resume Daemon is already running with PID {running_pid}.\n")
        sys.exit(1)
        
    log("Claude Auto-Resume Daemon started successfully.")
    
    # Write PID
    with open(PID_FILE, 'w') as f:
        f.write(str(os.getpid()))
        
    try:
        while True:
            sessions = get_active_sessions()
            active_ids = set()

            for s in sessions:
                sid = s.get("sessionId")
                if not sid:
                    continue
                active_ids.add(sid)

                # Actively generating — indeterminate; leave any tracking untouched.
                if s.get("status") == "busy":
                    continue

                blocked, banner_reset = check_session_rate_limited(s)

                if blocked:
                    tty = get_tty_for_pid(s.get("pid"))
                    if sid not in tracking_state:
                        reset_at = banner_reset or (datetime.now(timezone.utc) + timedelta(hours=5, minutes=10))
                        local = reset_at.astimezone()
                        log(f"[DETECTED] Session {sid[:8]} (PID {s.get('pid')}) is rate-limit blocked; will resume after {local:%Y-%m-%d %H:%M %Z} (once the limit is back up).")
                        notify("Claude rate-limited", f"Auto-resume scheduled for {local:%-I:%M %p}")
                        tracking_state[sid] = {"reset_at": reset_at, "attempts": 0, "tty": tty}
                    state = tracking_state[sid]
                    if tty:
                        state["tty"] = tty
                    now_dt = datetime.now(timezone.utc)
                    if now_dt < state["reset_at"]:
                        continue  # reset not reached yet — wait, do NOT nudge
                    if not state.get("tty"):
                        continue  # blocked but no terminal to send to
                    if state["attempts"] < MAX_RETRIES:
                        _, term_type = get_terminal_content(state["tty"])
                        log(f"[ACTION] Reset window elapsed — resuming {sid[:8]} on {state['tty']} ({term_type}). Attempt {state['attempts'] + 1}/{MAX_RETRIES}...")
                        result = send_enter(state["tty"], term_type)
                        if result == "sent":
                            if state["attempts"] == 0:
                                notify("Claude resumed", f"Sent 'continue' to session {sid[:8]}")
                            state["attempts"] += 1
                            state["reset_at"] = now_dt + timedelta(seconds=RETRY_INTERVAL_SECONDS)
                        else:
                            log(f"[ERROR] Failed to send resume to {state['tty']} ({term_type}). Result: {result}")
                    elif not state.get("logged_max"):
                        log(f"[MAX RETRIES] Resumed {MAX_RETRIES}x on {sid[:8]} but it still looks blocked. Waiting for manual intervention.")
                        state["logged_max"] = True
                else:
                    if sid in tracking_state:
                        log(f"[RESOLVED] Session {sid[:8]} is no longer rate-limited. Clearing tracking.")
                        tracking_state.pop(sid)

            # Drop tracking for sessions that have ended.
            for sid in list(tracking_state.keys()):
                if sid not in active_ids:
                    log(f"[CLEANUP] Session {sid[:8]} ended. Removing from tracking.")
                    tracking_state.pop(sid)

            time.sleep(CHECK_INTERVAL_SECONDS)
    except KeyboardInterrupt:
        log("Claude Auto-Resume Daemon stopped by user.")
    except Exception as e:
        log(f"CRITICAL ERROR in loop: {e}")
    finally:
        if os.path.exists(PID_FILE):
            os.remove(PID_FILE)

def daemonize():
    """Fork processes to run as daemon."""
    try:
        pid = os.fork()
        if pid > 0:
            sys.exit(0)
    except OSError as e:
        sys.stderr.write(f"Fork #1 failed: {e}\n")
        sys.exit(1)

    os.chdir('/')
    os.setsid()
    os.umask(0)

    try:
        pid = os.fork()
        if pid > 0:
            sys.exit(0)
    except OSError as e:
        sys.stderr.write(f"Fork #2 failed: {e}\n")
        sys.exit(1)

    sys.stdout.flush()
    sys.stderr.flush()
    
    # Redirect standard file descriptors to log file
    si = open(os.devnull, 'r')
    so = open(LOG_FILE, 'a+')
    se = open(LOG_FILE, 'a+')
    
    os.dup2(si.fileno(), sys.stdin.fileno())
    os.dup2(so.fileno(), sys.stdout.fileno())
    os.dup2(se.fileno(), sys.stderr.fileno())

def install_launchd():
    """Create launchd plist file and load it."""
    os.makedirs(os.path.dirname(PLIST_PATH), exist_ok=True)
    
    plist_content = f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.user.clauderesume</string>
    <key>ProgramArguments</key>
    <array>
        <string>{sys.executable}</string>
        <string>{os.path.abspath(__file__)}</string>
        <string>run</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>{LOG_FILE}</string>
    <key>StandardErrorPath</key>
    <string>{LOG_FILE}</string>
</dict>
</plist>
'''
    try:
        with open(PLIST_PATH, "w") as f:
            f.write(plist_content)
        
        # Load plist
        subprocess.check_call(["launchctl", "bootstrap", f"gui/{os.getuid()}", PLIST_PATH])
        print(f"Daemon installed and loaded successfully as LaunchAgent.")
        print(f"Plist path: {PLIST_PATH}")
        print(f"Log path: {LOG_FILE}")
    except Exception as e:
        print(f"Error installing LaunchAgent: {e}")
        print("Note: If already loaded, try running uninstall first.")

def uninstall_launchd():
    """Unload launchd plist file and delete it."""
    try:
        subprocess.run(["launchctl", "bootout", f"gui/{os.getuid()}", PLIST_PATH], stderr=subprocess.DEVNULL)
        if os.path.exists(PLIST_PATH):
            os.remove(PLIST_PATH)
        print("Daemon uninstalled and unloaded successfully.")
    except Exception as e:
        print(f"Error uninstalling LaunchAgent: {e}")

def get_daemon_status():
    """Checks if daemon is running."""
    if os.path.exists(PID_FILE):
        try:
            with open(PID_FILE, 'r') as f:
                pid = int(f.read().strip())
            os.kill(pid, 0)
            print(f"Claude Auto-Resume Daemon is RUNNING (PID {pid}).")
            return
        except (ValueError, OSError):
            pass
    print("Claude Auto-Resume Daemon is STOPPED.")

def stop_daemon():
    """Kills running daemon."""
    if os.path.exists(PID_FILE):
        try:
            with open(PID_FILE, 'r') as f:
                pid = int(f.read().strip())
            os.kill(pid, 15)  # SIGTERM
            print(f"Sent termination signal to Daemon (PID {pid}).")
            time.sleep(1)
            # Verify kill
            try:
                os.kill(pid, 0)
                os.kill(pid, 9)  # SIGKILL if still alive
                print("Force killed daemon process.")
            except OSError:
                pass
            if os.path.exists(PID_FILE):
                os.remove(PID_FILE)
            return
        except Exception as e:
            print(f"Error stopping daemon: {e}")
    print("No running daemon process found.")

if __name__ == "__main__":
    if not os.path.exists(CLAUDE_DIR):
        os.makedirs(CLAUDE_DIR, exist_ok=True)
        
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    
    if cmd == "run":
        running_pid = check_already_running()
        if running_pid:
            print(f"Daemon is already running with PID {running_pid}.")
            sys.exit(1)
        run_loop()
    elif cmd == "start":
        running_pid = check_already_running()
        if running_pid:
            print(f"Daemon is already running with PID {running_pid}.")
            sys.exit(1)
        daemonize()
        run_loop()

    elif cmd == "stop":
        stop_daemon()
    elif cmd == "status":
        get_daemon_status()
    elif cmd == "install":
        install_launchd()
    elif cmd == "uninstall":
        uninstall_launchd()
    else:
        print(f"Unknown command: {cmd}")
        print("Usage: python3 claude_resume_daemon.py [run|start|stop|status|install|uninstall]")
        sys.exit(1)
