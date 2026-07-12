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

## After it returns
1. **Sync (always):** `git diff --stat` / `git status` to confirm real changes.
2. **Review by judgment:** trust boilerplate, tests, and simple scripts. Read the diff line-by-line only for business logic, security, or DB migrations. `/kiro:review` buys a deeper second opinion cheaply.
