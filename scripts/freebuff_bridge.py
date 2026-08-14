#!/usr/bin/env python3
"""
Freebuff PTY Bridge
Automates running Freebuff CLI headlessly by managing pseudo-terminal (PTY) I/O,
handling modal transitions, and streaming/capturing task outputs for Claude Code & AGY.
"""

import argparse
import os
import pty
import re
import select
import struct
import subprocess
import sys
import termios
import time

ANSI_ESCAPE_PATTERN = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')

def clean_ansi(text: str) -> str:
    return ANSI_ESCAPE_PATTERN.sub('', text)

def set_terminal_size(fd, rows=40, cols=120):
    try:
        size = struct.pack("HHHH", rows, cols, 0, 0)
        import fcntl
        fcntl.ioctl(fd, termios.TIOCSWINSZ, size)
    except Exception:
        pass

def run_freebuff_task(prompt: str, cwd: str = None, timeout: int = 120, debug: bool = False):
    if not cwd:
        cwd = os.getcwd()
    
    cwd = os.path.abspath(cwd)
    os.makedirs(cwd, exist_ok=True)

    if not os.path.exists(os.path.join(cwd, '.git')):
        try:
            subprocess.run(['git', 'init'], cwd=cwd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass

    master_fd, slave_fd = pty.openpty()
    set_terminal_size(master_fd, rows=40, cols=120)

    env = os.environ.copy()
    env['TERM'] = 'xterm-256color'
    env['FORCE_COLOR'] = '0'

    cmd = ['freebuff', '--cwd', cwd]

    proc = subprocess.Popen(
        cmd,
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        cwd=cwd,
        env=env,
        close_fds=True
    )
    os.close(slave_fd)

    output_buffer = []
    clean_history = ""
    model_selected = False
    prompt_sent = False
    start_time = time.time()
    last_activity_time = time.time()
    
    while True:
        current_time = time.time()
        if current_time - start_time > timeout:
            if debug:
                print(f"\n[bridge] Timeout ({timeout}s) reached.", file=sys.stderr)
            break

        if proc.poll() is not None:
            if debug:
                print(f"\n[bridge] Process exited with code {proc.returncode}.", file=sys.stderr)
            break

        r, _, _ = select.select([master_fd], [], [], 0.1)
        if r:
            try:
                data = os.read(master_fd, 4096)
                if not data:
                    break
                text = data.decode('utf-8', errors='ignore')
                output_buffer.append(text)
                last_activity_time = time.time()

                cleaned = clean_ansi(text)
                clean_history += cleaned

                if debug:
                    sys.stdout.write(cleaned)
                    sys.stdout.flush()

                # 1. Handle Model Selection Modal
                if not model_selected and ("RECOMMENDED" in clean_history or "Start coding for free" in clean_history or "See all 5 models" in clean_history):
                    time.sleep(0.3)
                    os.write(master_fd, b'\r')
                    model_selected = True
                    if debug:
                        print("\n[bridge] Confirmed model selection modal.", file=sys.stderr)
                    clean_history = ""

                # 2. Handle Project Directory Picker if shown
                if "Select project directory" in clean_history and not prompt_sent:
                    time.sleep(0.3)
                    os.write(master_fd, b'\r')
                    clean_history = clean_history.replace("Select project directory", "")

                # 3. Handle Task Input Box
                if not prompt_sent and ("Enter a coding task" in clean_history or "Try one of these" in clean_history):
                    if current_time - start_time > 2.0:
                        time.sleep(0.5)
                        bracketed = f"\x1b[200~{prompt}\x1b[201~".encode('utf-8')
                        os.write(master_fd, bracketed)
                        time.sleep(0.3)
                        os.write(master_fd, b'\r')
                        prompt_sent = True
                        if debug:
                            print(f"\n[bridge] Task prompt injected via bracketed paste: '{prompt}'", file=sys.stderr)
                        clean_history = ""

            except OSError:
                break
        else:
            if prompt_sent and (current_time - last_activity_time > 15.0) and (current_time - start_time > 25.0):
                if debug:
                    print(f"\n[bridge] Output complete, wrapping up session.", file=sys.stderr)
                break

    try:
        proc.terminate()
        proc.wait(timeout=2)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass

    try:
        os.close(master_fd)
    except Exception:
        pass

    full_output = clean_ansi("".join(output_buffer))
    return full_output

def main():
    parser = argparse.ArgumentParser(description="Freebuff Headless PTY Bridge")
    parser.add_argument("-p", "--prompt", required=True, help="Task prompt or instructions to send to Freebuff")
    parser.add_argument("--cwd", default=None, help="Working directory for Freebuff")
    parser.add_argument("--timeout", type=int, default=120, help="Maximum execution timeout in seconds")
    parser.add_argument("--debug", action="store_true", help="Print raw live terminal output")

    args = parser.parse_args()
    
    result = run_freebuff_task(
        prompt=args.prompt,
        cwd=args.cwd,
        timeout=args.timeout,
        debug=args.debug
    )
    
    if not args.debug:
        print(result)

if __name__ == "__main__":
    main()
