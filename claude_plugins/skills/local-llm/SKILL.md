---
name: local-llm
description: How to offload work to the local Qwen 3.6 models (27B dense / 35B A3B MoE) running on this machine via llama-server — what they're good for, which one to pick, and the three ways to reach them from Claude Code, agy, and Kiro.
---

# local-llm

Two Qwen 3.6 models are served locally by `llama-server`. They are **free,
private, and unmetered** — but slow relative to a cloud model. Route work to
them when volume matters more than peak reasoning.

## Pick the model

| | 27B dense | 35B A3B (MoE) |
|---|---|---|
| decode | ~18 tok/s | **~67 tok/s** |
| quality (judged) | **8.7/10** | not separately graded |
| resident | 28 GB | 36 GB |
| use for | hard single questions where you'll wait | everything interactive |

**Default to 35B A3B.** It is ~4x faster for comparable work, which is the
difference between a usable agent loop and an unusable one. Reach for 27B only
when a single answer's quality justifies a 4x wait.

Only one fits in 64 GB at Q8, so switching *replaces* the resident model:
`llm-serve start 27b`. Check what's loaded with `llm-serve which`.

## Three ways in

**1. `qwen` CLI — the default.** Works from every harness, because every harness
has a shell tool (Claude Code `Bash`, agy `run_command`, Kiro `execute_bash`).
The local model has no filesystem access, so attach context explicitly:

```bash
qwen -f src/auth.ts "summarise this module in 5 bullets"
git diff | qwen "write a conventional-commit message"
qwen --think "why would this deadlock?" -f worker.go
```

Thinking is **off by default** — it costs ~10–20x the tokens and time. Turn it on
only for genuinely analytical questions.

**2. `local-qwen` subagent — to keep output out of context.** Delegate via
`subagent_type: "local-qwen"` when the local model's output is bulky and you only
need the conclusion. Same rules as any delegation: one call per batch, and give
it everything it needs in the prompt.

**3. `qwen-code` — the full agent loop on local weights.** Claude Code's entire
toolset driven by Qwen, via the Anthropic→OpenAI proxy:

```bash
qwen-code -p "fix the failing lint in src/"      # headless
claude_local_qwen_3.6_35                          # interactive, 35B
```

Realistic expectation: a 3-step edit-and-test task takes ~2 minutes. Good for
background chores and offline work; not a substitute for Opus on hard problems.

## What to send, what to keep

- **Send:** summarising files/logs/diffs, docstrings, changelogs, commit
  messages, explaining code, triaging search hits, first-draft boilerplate,
  anything you'd otherwise skim yourself.
- **Keep:** architecture, API design, security- or data-integrity-critical
  logic, multi-file refactors, and reviewing whatever the local model produced.

## When it's not answering

`llm-serve status` shows whether the server and proxy are up and which model is
resident. `llm-serve start` brings the stack up; `llm-serve logs` tails it. Do
not start it from inside a task without saying so — loading takes tens of
seconds and evicts the other model.
