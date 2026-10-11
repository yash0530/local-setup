#!/usr/bin/env python3
import os
import sys
import time
import json
import glob
import re
import signal
import subprocess
from datetime import datetime, timedelta, timezone

try:
    from zoneinfo import ZoneInfo
except Exception:
    ZoneInfo = None

# Configuration
CHECK_INTERVAL_SECONDS = 30
MAX_RETRIES = 3
GRACE_SECONDS = 15  # Buffer after stated reset instant before nudging

CLAUDE_DIR = os.path.expanduser("~/.claude")
CLAUDE_SESSIONS_DIR = os.path.join(CLAUDE_DIR, "sessions")
LOG_FILE = os.path.join(CLAUDE_DIR, "claude_resume_daemon.log")
PID_FILE = os.path.join(CLAUDE_DIR, "claude_resume_daemon.pid")
PLIST_PATH = os.path.expanduser("~/Library/LaunchAgents/com.user.clauderesume.plist")
MAX_LOG_SIZE = 5 * 1024 * 1024  # 5 MB

# Tracking state, keyed by sessionId:
#   { "reset_at": datetime, "attempts": int, "tty": str|None, "logged_max": bool }
tracking_state = {}

def handle_signal(sig, frame):
    """Clean exit on SIGTERM/SIGINT."""
    log(f"Claude Auto-Resume Daemon received signal {sig}, exiting cleanly.")
    if os.path.exists(PID_FILE):
        try:
            with open(PID_FILE, 'r') as f:
                p = int(f.read().strip())
            if p == os.getpid():
                os.remove(PID_FILE)
        except Exception:
            pass
    sys.exit(0)

signal.signal(signal.SIGTERM, handle_signal)
signal.signal(signal.SIGINT, handle_signal)

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

def rotate_log_if_needed():
    """Trim log file if it exceeds MAX_LOG_SIZE to keep disk usage bounded."""
    try:
        if os.path.exists(LOG_FILE) and os.path.getsize(LOG_FILE) > MAX_LOG_SIZE:
            with open(LOG_FILE, "rb") as f:
                f.seek(-500 * 1024, os.SEEK_END)
                f.readline()  # align to next newline
                tail_bytes = f.read()
            with open(LOG_FILE, "wb") as f:
                f.write(tail_bytes)
    except Exception:
        pass

def is_daemon_process(pid):
    """Checks if a process is alive and is actually claude_resume_daemon."""
    if not pid or pid == os.getpid():
        return False
    try:
        os.kill(pid, 0)
    except (OSError, ProcessLookupError):
        return False
    try:
        cmdline = subprocess.check_output(
            ["ps", "-p", str(pid), "-o", "command="],
            text=True, stderr=subprocess.DEVNULL
        ).strip()
        return "claude_resume_daemon" in cmdline
    except Exception:
        return False

def check_already_running():
    """Checks if another instance of the daemon is already running.
    Cleans up stale PID files left behind by crashes or reboot PID recycling."""
    if os.path.exists(PID_FILE):
        try:
            with open(PID_FILE, 'r') as f:
                pid = int(f.read().strip())
            if pid != os.getpid():
                if is_daemon_process(pid):
                    return pid
                else:
                    # Stale PID file: process is not claude_resume_daemon
                    try:
                        os.remove(PID_FILE)
                    except Exception:
                        pass
        except (ValueError, OSError):
            pass
    return None

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
                # Check if process is alive and is actually claude
                try:
                    os.kill(pid, 0)
                    cmdline = subprocess.check_output(
                        ["ps", "-p", str(pid), "-o", "command="],
                        text=True, stderr=subprocess.DEVNULL
                    ).strip()
                    if "claude" in cmdline:
                        sessions.append(data)
                except (OSError, Exception):
                    pass
        except Exception:
            pass
    return sessions

def normalize_tty(tty_path):
    if not tty_path:
        return ""
    tty_path = tty_path.strip()
    return tty_path if tty_path.startswith("/dev/") else f"/dev/{tty_path}"

def check_tmux(tty_path):
    """Checks if a TTY is active in a tmux session."""
    tty_path = normalize_tty(tty_path)
    try:
        panes_output = subprocess.check_output(
            ["tmux", "list-panes", "-a", "-F", "#{pane_tty}"],
            text=True, stderr=subprocess.DEVNULL
        ).strip().split('\n')
        for pane_tty in panes_output:
            pane_tty = normalize_tty(pane_tty)
            if pane_tty == tty_path or os.path.basename(pane_tty) == os.path.basename(tty_path):
                return True
    except Exception:
        pass
    return False

def check_iterm(tty_path):
    """Checks if a TTY is active in an iTerm2 session."""
    tty_path = normalize_tty(tty_path)
    tty_name = os.path.basename(tty_path)
    script = f'''
    if application "iTerm" is running then
        tell application "iTerm"
            repeat with w in windows
                repeat with t in tabs of w
                    repeat with s in sessions of t
                        set s_tty to tty of s
                        if s_tty is "{tty_path}" or s_tty is "{tty_name}" then
                            return "yes"
                        end if
                    end repeat
                end repeat
            end repeat
        end tell
    end if
    return "no"
    '''
    try:
        res = subprocess.check_output(["osascript", "-e", script], text=True, stderr=subprocess.DEVNULL, timeout=5).strip()
        return res == "yes"
    except Exception:
        return False

def check_terminal_app(tty_path):
    """Checks if a TTY is active in Terminal.app."""
    tty_path = normalize_tty(tty_path)
    script = f'''
    if application "Terminal" is running then
        tell application "Terminal"
            repeat with w in windows
                repeat with t in tabs of w
                    if tty of t is "{tty_path}" then
                        return "yes"
                    end if
                end repeat
            end repeat
        end tell
    end if
    return "no"
    '''
    try:
        res = subprocess.check_output(["osascript", "-e", script], text=True, stderr=subprocess.DEVNULL, timeout=5).strip()
        return res == "yes"
    except Exception:
        return False

def get_tty_for_pid(pid):
    """Gets the outer TTY name for a process PID by traversing up the process tree.
    
    If the process is running in a wrapper (like kiro-cli-term/node-pty) that allocates
    a pseudo-terminal, the actual terminal emulator tab/pane runs on the outer TTY.
    We traverse up the process tree to find the TTY of the first ancestor that is
    associated with an active Terminal.app, iTerm2, or tmux session.
    """
    curr_pid = pid
    visited = set()
    fallback_tty = None
    
    while curr_pid and curr_pid not in visited:
        visited.add(curr_pid)
        try:
            output = subprocess.check_output(["ps", "-p", str(curr_pid), "-o", "tty="], text=True, stderr=subprocess.DEVNULL).strip()
            if output and "?" not in output:
                tty = normalize_tty(output)
                if fallback_tty is None:
                    fallback_tty = tty
                
                # Check if this TTY is active in any terminal emulator
                if check_tmux(tty) or check_iterm(tty) or check_terminal_app(tty):
                    return tty
        except Exception:
            pass
            
        # Get PPID
        try:
            output = subprocess.check_output(["ps", "-o", "ppid=", "-p", str(curr_pid)], text=True, stderr=subprocess.DEVNULL).strip()
            if output:
                curr_pid = int(output)
            else:
                break
        except Exception:
            break
            
    return fallback_tty

def send_terminal_app_enter(tty_path):
    """Sends 'continue' command to Terminal.app tab matching tty_path."""
    tty_path = normalize_tty(tty_path)
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
        return subprocess.check_output(["osascript", "-e", script], text=True, stderr=subprocess.DEVNULL, timeout=5).strip()
    except Exception:
        return "error"

def send_iterm_enter(tty_path):
    """Sends 'continue' command to iTerm2 session matching tty_path."""
    tty_path = normalize_tty(tty_path)
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
        return subprocess.check_output(["osascript", "-e", script], text=True, stderr=subprocess.DEVNULL, timeout=5).strip()
    except Exception:
        return "error"

def send_tmux_enter(tty_path):
    """Sends 'continue' command to tmux pane matching tty_path."""
    tty_path = normalize_tty(tty_path)
    try:
        panes_output = subprocess.check_output(
            ["tmux", "list-panes", "-a", "-F", "#{pane_tty} #{session_name}:#{window_index}.#{pane_index}"],
            text=True, stderr=subprocess.DEVNULL
        ).strip().split('\n')
        
        for line in panes_output:
            parts = line.split(maxsplit=1)
            if len(parts) == 2:
                pane_tty, pane_id = parts
                pane_tty = normalize_tty(pane_tty)
                if pane_tty == tty_path or os.path.basename(pane_tty) == os.path.basename(tty_path):
                    subprocess.check_call(["tmux", "send-keys", "-t", pane_id, "continue", "C-m"], stderr=subprocess.DEVNULL)
                    return "sent"
    except Exception:
        pass
    return "not_found"

def get_terminal_content(tty_path):
    """Identifies which terminal emulator owns matching tty_path."""
    if not tty_path:
        return "", None
    if check_tmux(tty_path):
        return "", "tmux"
    if check_iterm(tty_path):
        return "", "iterm"
    if check_terminal_app(tty_path):
        return "", "terminal"
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
            check=False, timeout=5, stderr=subprocess.DEVNULL, stdout=subprocess.DEVNULL
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

    Supports:
    1. Clock time banners, e.g. 'resets 4:30pm (America/Los_Angeles)' or 'try again at 3:20am'
    2. Relative time banners, e.g. 'resets in 15 minutes' or 'try again in 2 hours'
    """
    if not text:
        return None

    # 1. Check relative format: 'resets in 15 minutes' / 'try again in 2 hours'
    m_rel = re.search(r"(?:reset(?:s)?|try again)\s+in\s+(\d+)\s*(m(?:in(?:ute)?s?)?|h(?:(?:ou)?rs?)?|s(?:ec(?:ond)?s?)?)", text.lower())
    if m_rel:
        val = int(m_rel.group(1))
        unit = m_rel.group(2) or "m"
        anchor = hit_dt or datetime.now(timezone.utc)
        if unit.startswith("h"):
            return anchor + timedelta(hours=val)
        elif unit.startswith("s"):
            return anchor + timedelta(seconds=val)
        else:
            return anchor + timedelta(minutes=val)

    # 2. Check clock format: 'resets 4:30pm' / 'try again at 3:20am'
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

def _tail_lines(path, max_lines=300, chunk=131072):
    """Read roughly the last `max_lines` lines of a file efficiently."""
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

def _recent_entries(path, max_lines=300):
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
    """Authoritative rate-limit check via Claude Code's STRUCTURED transcript.

    A session is blocked if its most recent assistant turn is a rate-limit error:
    - isApiErrorMessage == true AND (error == "rate_limit" OR apiErrorStatus == 429)
    OR
    - quotaLimits.status == "rejected"

    Extracts exact reset instant from quotaLimits.resetsAt (Unix timestamp) if present,
    or falls back to parsing the reset banner string.

    Returns (blocked: bool, reset_at: datetime|None).
    """
    path = get_transcript_path(session)
    if not path:
        return (False, None)

    for entry in reversed(_recent_entries(path, max_lines=300)):
        if entry.get("type") != "assistant":
            continue  # skip user/system/tool rows; the latest *assistant* turn represents the state

        is_limit = (
            entry.get("isApiErrorMessage") is True and (
                entry.get("error") == "rate_limit" or entry.get("apiErrorStatus") == 429
            )
        ) or (
            isinstance(entry.get("quotaLimits"), dict) and entry.get("quotaLimits", {}).get("status") == "rejected"
        )

        if is_limit:
            # 1. Prefer machine-structured Unix epoch in quotaLimits.resetsAt
            ql = entry.get("quotaLimits")
            if isinstance(ql, dict) and ql.get("resetsAt"):
                try:
                    resets_epoch = int(ql["resetsAt"])
                    return (True, datetime.fromtimestamp(resets_epoch, tz=timezone.utc))
                except Exception:
                    pass

            # 2. Fall back to text parsing from entry content
            banner_text = _entry_text(entry)
            ts = _parse_iso(entry.get("timestamp"))
            return (True, parse_reset_time(banner_text, ts))

        # Newest assistant turn is a normal response → session is working / resumed
        return (False, None)

    return (False, None)

def run_loop():
    """Main polling loop."""
    running_pid = check_already_running()
    if running_pid:
        sys.stderr.write(f"Error: Claude Auto-Resume Daemon is already running with PID {running_pid}.\n")
        sys.exit(1)

    rotate_log_if_needed()
    log("Claude Auto-Resume Daemon started successfully.")

    # Write PID
    with open(PID_FILE, 'w') as f:
        f.write(str(os.getpid()))

    loop_count = 0
    try:
        while True:
            loop_count += 1
            if loop_count % 120 == 0:  # ~1 hour
                rotate_log_if_needed()

            sessions = get_active_sessions()
            active_ids = set()

            for s in sessions:
                sid = s.get("sessionId")
                if not sid:
                    continue
                active_ids.add(sid)

                # Authoritative rate limit check.
                # Notice: We intentionally do NOT skip if s.get("status") == "busy" because
                # sessions that hit rate-limits during subagents or multi-turn execution
                # often retain status="busy" in sessions/*.json.
                blocked, banner_reset = check_session_rate_limited(s)

                if blocked:
                    tty = get_tty_for_pid(s.get("pid"))
                    if sid not in tracking_state:
                        base_reset = banner_reset or (datetime.now(timezone.utc) + timedelta(hours=5))
                        reset_at = base_reset + timedelta(seconds=GRACE_SECONDS)
                        local = reset_at.astimezone()
                        log(f"[DETECTED] Session {sid[:8]} (PID {s.get('pid')}) is rate-limit blocked; will resume after {local:%Y-%m-%d %H:%M:%S %Z}.")
                        notify("Claude rate-limited", f"Auto-resume scheduled for {local:%-I:%M %p}")
                        tracking_state[sid] = {
                            "reset_at": reset_at,
                            "attempts": 0,
                            "tty": tty,
                            "logged_max": False
                        }
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
                        attempt_num = state["attempts"] + 1
                        log(f"[ACTION] Reset window elapsed — resuming {sid[:8]} on {state['tty']} ({term_type}). Attempt {attempt_num}/{MAX_RETRIES}...")
                        result = send_enter(state["tty"], term_type)
                        if result == "sent":
                            if state["attempts"] == 0:
                                notify("Claude resumed", f"Sent 'continue' to session {sid[:8]}")
                            state["attempts"] += 1
                            # Attempt 1 retry is 60s (in case of slight server clock skew); subsequent retries 300s
                            delay = 60 if state["attempts"] == 1 else 300
                            state["reset_at"] = now_dt + timedelta(seconds=delay)
                        else:
                            log(f"[ERROR] Failed to send resume to {state['tty']} ({term_type}). Result: {result}")
                            state["reset_at"] = now_dt + timedelta(seconds=30)
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
            try:
                with open(PID_FILE, 'r') as f:
                    p = int(f.read().strip())
                if p == os.getpid():
                    os.remove(PID_FILE)
            except Exception:
                pass

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
    """Create launchd plist file and load it idempotently."""
    os.makedirs(os.path.dirname(PLIST_PATH), exist_ok=True)
    
    python_bin = "/usr/bin/python3" if os.path.exists("/usr/bin/python3") else sys.executable
    target_script = os.path.expanduser("~/.claude/claude_resume_daemon.py")

    # If installed target script doesn't exist, copy current file there
    if not os.path.exists(target_script) or os.path.abspath(__file__) != target_script:
        try:
            with open(__file__, 'r') as src, open(target_script, 'w') as dst:
                dst.write(src.read())
            os.chmod(target_script, 0o755)
        except Exception:
            pass

    plist_content = f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.user.clauderesume</string>
    <key>ProgramArguments</key>
    <array>
        <string>{python_bin}</string>
        <string>{target_script}</string>
        <string>run</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ProcessType</key>
    <string>Background</string>
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
        
        uid = os.getuid()
        # Bootout existing instance first so bootstrap doesn't fail with I/O error 5
        subprocess.run(["launchctl", "bootout", f"gui/{uid}", PLIST_PATH], stderr=subprocess.DEVNULL, stdout=subprocess.DEVNULL)
        time.sleep(0.5)

        # Clean any stale PID file before starting
        if os.path.exists(PID_FILE):
            try:
                pid = int(open(PID_FILE).read().strip())
                if not is_daemon_process(pid):
                    os.remove(PID_FILE)
            except Exception:
                pass

        # Load plist
        subprocess.check_call(["launchctl", "bootstrap", f"gui/{uid}", PLIST_PATH])
        # Kickstart to ensure running immediately
        subprocess.run(["launchctl", "kickstart", "-k", f"gui/{uid}/com.user.clauderesume"], stderr=subprocess.DEVNULL, stdout=subprocess.DEVNULL)
        print(f"Daemon installed and loaded successfully as LaunchAgent.")
        print(f"Plist path: {PLIST_PATH}")
        print(f"Log path: {LOG_FILE}")
    except Exception as e:
        print(f"Error installing LaunchAgent: {e}")

def uninstall_launchd():
    """Unload launchd plist file and delete it."""
    try:
        subprocess.run(["launchctl", "bootout", f"gui/{os.getuid()}", PLIST_PATH], stderr=subprocess.DEVNULL, stdout=subprocess.DEVNULL)
        if os.path.exists(PLIST_PATH):
            os.remove(PLIST_PATH)
        if os.path.exists(PID_FILE):
            os.remove(PID_FILE)
        print("Daemon uninstalled and unloaded successfully.")
    except Exception as e:
        print(f"Error uninstalling LaunchAgent: {e}")

def get_daemon_status():
    """Checks if daemon is running and displays detailed status."""
    running_pid = None
    if os.path.exists(PID_FILE):
        try:
            with open(PID_FILE, 'r') as f:
                pid = int(f.read().strip())
            if is_daemon_process(pid):
                running_pid = pid
            else:
                try:
                    os.remove(PID_FILE)
                except Exception:
                    pass
        except Exception:
            pass

    if not running_pid:
        try:
            out = subprocess.check_output(["pgrep", "-f", "claude_resume_daemon.py"], text=True, stderr=subprocess.DEVNULL).strip().split()
            for p in out:
                p_int = int(p)
                if p_int != os.getpid() and is_daemon_process(p_int):
                    running_pid = p_int
                    break
        except Exception:
            pass

    print("--- Claude Auto-Resume Daemon Status ---")
    if running_pid:
        print(f"Daemon process: RUNNING (PID: {running_pid})")
    else:
        print("Daemon process: STOPPED")

    # Launchd state
    loaded = False
    try:
        out = subprocess.check_output(["launchctl", "list"], text=True, stderr=subprocess.DEVNULL)
        for line in out.splitlines():
            if "com.user.clauderesume" in line:
                loaded = True
                print(f"LaunchAgent (launchd): LOADED ({line.strip()})")
                break
    except Exception:
        pass
    if not loaded:
        print("LaunchAgent (launchd): NOT LOADED")

    print(f"Plist: {PLIST_PATH}")
    print(f"Log: {LOG_FILE}")
    print()

    # Active sessions
    sessions = get_active_sessions()
    print(f"--- Monitored Claude Sessions ({len(sessions)}) ---")
    if not sessions:
        print("No active Claude Code sessions found.")
    else:
        for s in sessions:
            sid = s.get("sessionId", "unknown")
            pid = s.get("pid", "?")
            cwd = s.get("cwd", "?")
            tty = get_tty_for_pid(pid)
            _, term_type = get_terminal_content(tty) if tty else ("", None)
            blocked, reset_at = check_session_rate_limited(s)

            term_info = f"{tty or 'unknown'} ({term_type or 'unknown'})"
            if blocked:
                if reset_at:
                    local_reset = reset_at.astimezone()
                    now_utc = datetime.now(timezone.utc)
                    remaining = reset_at - now_utc
                    if remaining.total_seconds() > 0:
                        rem_str = f"in {str(remaining).split('.')[0]}"
                    else:
                        rem_str = "reset window passed, pending resume"
                    print(f"• [{sid[:8]}] (PID {pid}, {cwd}) on {term_info}")
                    print(f"  STATE: RATE-LIMITED — resets at {local_reset:%Y-%m-%d %H:%M:%S %Z} ({rem_str})")
                else:
                    print(f"• [{sid[:8]}] (PID {pid}, {cwd}) on {term_info}")
                    print(f"  STATE: RATE-LIMITED — reset time unknown")
            else:
                status_label = s.get("status", "active")
                print(f"• [{sid[:8]}] (PID {pid}, {cwd}) on {term_info}")
                print(f"  STATE: OK ({status_label})")

def stop_daemon():
    """Kills running daemon and cleans up PID file."""
    killed = False
    if os.path.exists(PID_FILE):
        try:
            with open(PID_FILE, 'r') as f:
                pid = int(f.read().strip())
            if is_daemon_process(pid):
                os.kill(pid, 15)  # SIGTERM
                time.sleep(1)
                try:
                    os.kill(pid, 0)
                    os.kill(pid, 9)  # SIGKILL if still alive
                except OSError:
                    pass
                killed = True
                print(f"Stopped running daemon process (PID {pid}).")
        except Exception as e:
            print(f"Error stopping daemon: {e}")
        finally:
            if os.path.exists(PID_FILE):
                try:
                    os.remove(PID_FILE)
                except Exception:
                    pass

    try:
        out = subprocess.check_output(["pgrep", "-f", "claude_resume_daemon.py"], text=True, stderr=subprocess.DEVNULL).strip().split()
        for p in out:
            p_int = int(p)
            if p_int != os.getpid():
                os.kill(p_int, 15)
                killed = True
    except Exception:
        pass

    if not killed:
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
