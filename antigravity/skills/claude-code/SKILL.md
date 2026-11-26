---
name: claude-code
description: >-
  Use this skill to collaborate with the local Claude Code CLI (`claude`) on
  Opus 5.5 high as a trusted peer for codebase research and investigation,
  parallel implementation tasks, and independent code, architecture, or visual
  reviews.
---

# Claude Code CLI (`claude`, Opus 5.5 High)

Collaborate with the local `claude` CLI (`$HOME/.local/bin/claude`) on Opus 5.5 high as a trusted, equal co-worker. You decide **when** to bring Claude in and **what** goal to hand off; once given a clear objective, trust Claude to explore, reason, build, or review independently.

## Core Principle: Delegate Early to Save Your Tokens

A main reason to bring Claude in is to offload heavy work and **save your own tokens and context window**:

- **Hand off early with a high-level plan:** Give Claude the goal, high-level plan, and hard constraints right away, and let Claude read the codebase, do the research, trace bugs, implement, and verify on its own.
- **Don't do Claude's homework upfront:** Avoid burning turns reading dozens of files or drafting a massive micro-spec before invoking Claude — if preparing the handoff costs more tokens than doing the work yourself, you defeat the point.

## Ways to Work Together

- **Research & deep investigation:** Hand Claude an unfamiliar subsystem, tricky bug, or open architectural question and let it explore the codebase, trace execution paths, and report back its findings.
- **Implementation & parallel work:** Delegate features, refactors, fixes, or verification scripts in parallel — use `--worktree` when you're also editing the same repository so neither of you steps on the other's files.
- **Cross-model reviews & second opinions:** Get a fresh-eyes review on diffs, plans, architecture trade-offs, or visual/screenshot captures (Claude's `Read` tool natively inspects PNG/JPG images).
- **Keep trivial work local:** Skip spinning up a separate CLI session for quick one-liners or edits that take seconds to do directly.

## Required Model & Auth Flags

Always pass **both** flags explicitly:

```text
--model claude-opus-5-5 --effort high
```

- Do not rely on `--model opus` alone (aliases can drift) and do not omit `--effort high` (per-model settings in `~/.claude/settings.json` may default `claude-opus-5-5` to `medium`).
- **Never pass `--bare`** when using a `claude.ai` OAuth subscription — `--bare` disables OAuth/keychain auth and requires `ANTHROPIC_API_KEY`.
- **Never modify `~/.claude/settings.json`** or attempt interactive `claude auth login`; if auth fails, report stderr and stop.

## Invocation Patterns

Run inside a subshell with an explicit working directory: `(cd "<repo_dir>" && claude ...)`. Pass CLI flags as real arguments rather than describing them in prompt prose.

### 1. Research & Deep Investigation

Let Claude explore the repo freely to trace bugs, map subsystems, or analyze design options. To keep your active working tree untouched while Claude investigates:

```bash
(cd "<repo_dir>" && claude -p "<research question or investigation goal>" \
  --model claude-opus-5-5 \
  --effort high \
  --restricted \
  --tools "Read,Glob,Grep" \
  --permission-prompts none \
  --strict-mcp-config \
  --disable-slash-commands \
  --max-turns 15)
```

- Need Claude to run read-only diagnostics (`git log`, test repros, inspectors) or use full tooling while researching? Drop `--restricted` and use `--permission-mode plan` (or pass `--tools "Read,Glob,Grep,Bash"` with `--allowedTools` for the commands you want).
- Pass `--add-dir "<extra_dir>"` (repeatable) if Claude should also inspect files or screenshots outside `<repo_dir>`.
- Add `--no-session-persistence` for one-off queries, or omit it when you may follow up with `--resume <session_id>`.

### 2. Implementation & Parallel Work

Use `-w` / `--worktree "<task-slug>"` when working in parallel with edits in the main checkout (or omit `--worktree` when you're handing off the active working tree cleanly):

```bash
(cd "<repo_dir>" && claude -p "<clear goal, constraints, and verification expectations>" \
  --model claude-opus-5-5 \
  --effort high \
  --worktree "<task-slug>" \
  --permission-mode acceptEdits \
  --permission-prompts none \
  --strict-mcp-config \
  --disable-slash-commands \
  --max-turns 25)
```

- Keep the handoff concise — pass the high-level plan, goal, constraints, and verification expectations directly in the prompt (or a short scratch file with `--add-dir "<dir>"` for multi-part goals) and let Claude look up the exact files and implementation details itself.
- Note that `~/.claude/settings.json` may default to `bypassPermissions`; use `--permission-mode acceptEdits` (optionally with `--allowedTools` for build/test commands) when you want clean non-interactive permissions in a worktree.
- Once Claude finishes, sync up via `git status` / `git diff` so your context matches what changed, integrate the branch/edits, and clean up temporary worktrees.

### 3. Cross-Model Reviews & Second Opinions

Pipe a diff directly or point Claude at files, plans, or screenshots (`--add-dir` for external artifact folders):

```bash
(cd "<repo_dir>" && git diff HEAD | claude -p \
  "Review this diff for bugs, edge cases, and design trade-offs. Read surrounding repo files wherever helpful for context." \
  --model claude-opus-5-5 \
  --effort high \
  --restricted \
  --tools "Read,Glob,Grep" \
  --permission-prompts none \
  --strict-mcp-config \
  --disable-slash-commands \
  --no-session-persistence \
  --max-turns 10)
```

### Structured Output & Follow-ups

- Add `--output-format json` when you want structured metadata (`result`, `modelUsage`, `session_id`, `total_cost_usd`).
- Continue an earlier investigation or task with `--resume <session_id>` (when `--no-session-persistence` was omitted).

## Practical Pacing & Runtime Notes

- **Be mindful of the 5-hour usage window:** Claude Pro shares a rolling 5-hour window across sessions. Group related questions or goals into cohesive handoffs rather than rapid-fire micro-calls, and use `--max-turns` as a sensible upper bound.
- **Handle rate limits cleanly:** On `rate_limit`, `429`, or quota-window errors, stop and inform the user rather than retrying in a loop or silently switching models.
- **Expect multi-minute runs:** Opus 5.5 at `high` effort routinely takes 1–5+ minutes on deep research, reviews, or builds. Set `NotificationTimeoutSeconds` (e.g., `180`–`300`) on `run_command` and let the task notify you on completion instead of polling.
- **Keep handoffs clean:** Never inline secrets, tokens, credentials, or hardcoded personal home paths in prompts or scratch files (use `$HOME` or repo-relative paths).
- **Pre-flight on failure:** If `claude` exits non-zero, check `command -v claude || ls "$HOME/.local/bin/claude"` and `claude auth status`, then surface stderr verbatim.
