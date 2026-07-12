---
name: agy-delegation
description: How to delegate coding to the Antigravity CLI (`agy`) via the `agy:runner` subagent to save Opus tokens — when to delegate, the spec-in-file pattern, structured invocation, and how to sync/verify cheaply.
---

# agy-delegation

Delegate coding to `agy` (Gemini) via `subagent_type: "agy:runner"` so its verbose output stays out of Opus's context. **Opus plans and supervises; agy does the grunt and self-verifies.** Worth it only when the spec is shorter than the code it produces.

## Split the work — aim ~60–75% to agy
agy carries the bulk of the straightforward implementation; Opus keeps the judgment-heavy minority. **Don't reflexively send everything** — and don't keep everything either.
- **To agy (the grunt, ~⅔):** implementing a design you've already specced, boilerplate, mechanical/repetitive refactors, test writing, wiring, scripts, CRUD, format/lint churn.
- **Keep on Opus (~¼–⅓):** planning & architecture, API/boundary design, subtle or security/data-integrity-critical logic, integration decisions, and reviewing agy's output. Plus anything where the spec would be longer or subtler than the code, and trivial one-liners (inline, or `/agy:ask`).

## How
1. **Spec once** to `scratch/agy/<task>.md`: intent, hard constraints, exact files to create/touch, existing utils/patterns to reuse (with paths), the gates, and "append a `## Result` summary; do NOT commit."
2. **Tiny pointer prompt:** `Read scratch/agy/<task>.md and implement it fully. Run the gates; fix until green; append ## Result. Don't commit.`
3. **One delegation per batch** — agy does multi-file work itself; never fan out into N runner calls. Say "work in stages X→Y→Z" if a sequence helps.
4. **Keep agy CLI flags out of the task prose.** If you need `--continue`, `--conversation`, or `--sandbox`, pass them as real flags after the prompt — described in the instructions, agy may bake them into the code. Resume a failed task with `--continue`, not a fresh re-spec.
5. **Foreground by default.** Use `run_in_background: true` only for a long batch (>~8 min); then make no workspace edits and start no other agy task until it returns (serial lock — overlapping runs clobber files).

## Gates (include in every spec)
`npx tsc --noEmit` · `npm test` · `npm run build` (UI/route changes only). agy fixes until green and reports them in `## Result`.

## After it returns
1. **Sync (always):** `git diff --stat` / `git status` to confirm real changes and re-anchor file & symbol names — agy may have renamed or added things; don't keep reasoning from stale memory.
2. **Review by judgment:** trust boilerplate, tests, and simple scripts — don't re-run gates agy already ran. Read the diff line-by-line only for business logic, security, or DB migrations. `/agy:review` (pipes `git diff HEAD` to agy) buys a deeper second opinion cheaply.
3. **Circuit breaker:** zero diff → do it inline, don't re-fire. Max 2 retries (fix the spec from the gate logs between tries), then inline. A returned runner can't be resumed via SendMessage — re-spawn or inline.
