---
name: kiro
description: How to delegate coding to the Kiro CLI (`kiro-cli`) via the `kiro:runner` subagent to save tokens — when to delegate, the spec-in-file pattern, structured invocation, and how to sync/verify cheaply.
---

# Kiro CLI Delegation

Delegate coding to `kiro-cli` via `subagent_type: "kiro:runner"` so its verbose output stays out of your context. **You plan and supervise; Kiro does the grunt work and self-verifies.** Worth it only when the spec is shorter than the code it produces.

## Split the work — aim ~60–75% to Kiro
Kiro carries the bulk of the straightforward implementation; you keep the judgment-heavy minority.
- **To Kiro:** implementing a design you've already specced, boilerplate, mechanical/repetitive refactors, test writing, wiring, scripts, CRUD, format/lint churn.
- **Keep for yourself:** planning & architecture, API/boundary design, subtle or security/data-integrity-critical logic, integration decisions, and reviewing Kiro's output. Plus anything where the spec would be longer or subtler than the code, and trivial one-liners.

## How to Delegate
1. **Spec once** to `scratch/kiro/<task>.md`: intent, hard constraints, exact files to create/touch, existing utils/patterns to reuse (with paths), the gates, and "append a `## Result` summary; do NOT commit."
2. **Tiny pointer prompt:** `Read scratch/kiro/<task>.md and implement it fully. Run the gates; fix until green; append ## Result. Don't commit.`
3. **One delegation per batch** — Kiro does multi-file work itself; never fan out into N runner calls.
4. **Foreground by default.** Use `run_in_background: true` only for a long batch (>~8 min); then make no workspace edits and start no other Kiro task until it returns (serial lock — overlapping runs clobber files).

## Gotchas (learned the hard way)
- **Tool trust:** `kiro-cli --no-interactive` denies every tool call unless trusted ("non-interactive mode (no user to approve)") and returns having done nothing. The wrapper now passes `--trust-all-tools` by default; `KIRO_TRUST=read` restricts to read-only tools.
- **Models:** `--model opus` = Claude Opus 5.5, `sonnet` = Sonnet 5. Aliases in `scripts/kiro-run.sh` go stale as kiro adds models — check `kiro-cli chat --list-models` when a user names a specific version.
- **Long runs:** the runner's Bash call caps at 10 min. For bigger batches tell the runner the task is long so it uses its background-and-poll pattern.
- **Shared checkout:** if anything else is running from the repo (a benchmark, a server), give Kiro its own `git worktree` so its edits can't change live scripts, then merge.
- **Put hard rules in the spec:** which paths are off-limits, "static edits only / don't start servers", "don't push". Kiro follows the spec file closely.

## Measuring cost exactly (learned 2026-11-01)
- Kiro writes the credits of every turn to `~/.kiro/sessions/<hash>/sess_<id>/messages.jsonl` (`usage_summary` records);
  `session.json` beside it names the working folder, agent profile, model and effort. So measure, don't ask the owner
  for the app's usage %: `python3 scripts/kiro-usage.py --by prefix --since 2026-11-01T19:00` (UTC). Give each task its
  own working folder so its cost is attributable. Roughly 10-11 credits = 1% of the monthly allowance (Nov 2026).
- **Every tool call re-sends the whole context.** A Haiku reader making ~50 tool calls cost ~18 credits; the same work
  as ONE call with the documents inline in the prompt cost 1.3-3.5. Telling the model "use no tools" is not enough
  (red teams still made 20-40 calls); the default profile also adds overhead (~2.5 credits vs 0.3 for the same call).
- **One-call pattern for bulk work:** put every input in the prompt (argv holds ~1 MB), run under a no-tools agent
  profile, and have the model answer with JSON between markers that Python extracts and validates. The profile:
  `~/.kiro/agents/fin-oneshot.json` (copy in `agents-kiro/`) with `"tools": [], "allowedTools": [], "includeMcpJson": false`, used as
  `kiro-cli chat --no-interactive --agent fin-oneshot --model claude-haiku-5.5 --effort high "<prompt>"`.
  Text output under `script -q /dev/null` is not wrapped, so long JSON lines survive. Retry a failed validation by
  resuming (`-r`) with only the errors.
- **Effort:** check the log for `[warn] failed to set effort`. Haiku 5.5's top level is `high` (`max` is not applied).
  Kiro drops `--effort` when many sessions start in the same second; start bulk tasks a few seconds apart.
- Output and thinking cost more than input: long JSON answers and max effort dominate a one-call task's credits.

## After it returns
1. **Sync (always):** `git diff --stat` / `git status` to confirm real changes.
2. **Review by judgment:** trust boilerplate, tests, and simple scripts. Read the diff line-by-line only for business logic, security, or DB migrations. `/kiro:review` buys a deeper second opinion cheaply.
