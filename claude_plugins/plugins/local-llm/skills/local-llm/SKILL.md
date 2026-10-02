---
name: local-llm
description: "Reference for the local Qwen 3.8 27B model (LM Studio Splash, 4-bit) — how to start it and the three ways to reach them. OPT-IN ONLY: read this when the user explicitly asks about or for the local model ('ask qwen', 'use the local model', 'llm-serve', 'qwen-code'). This skill does NOT authorise routing work to local models on your own judgement — never do that."
---

# local-llm

Qwen 3.8 27B can be served locally on LM Studio's Splash engine (4-bit). This skill is **reference material for when the user asks
for it** — it is not a suggestion to use it.

## Routing policy (the important part)

**Never send work to the local model unless the user explicitly asked in the
current request.** This setup exists for deliberate experimentation with local
models. The user pays for a Claude subscription and expects that quality by
default; silently substituting a 27B local model degrades their real work.

Concretely:

- A task being bulky, repetitive, or "cheap enough for a small model" is **not**
  a reason to route it locally. Do it yourself.
- Do not suggest offloading to the local model unprompted.
- The `local-qwen` subagent and the `qwen` CLI are opt-in tools, not defaults.

Explicit triggers look like: "ask qwen…", "use the local model", "run this
locally", "use local-qwen", "test this on the 27B".

## The model

One model: `splash4` (Qwen 3.8 27B, 4-bit + DFlash2 drafter on LM Studio Splash).
~35–84 tok/s decode, warm follow-ups in 1–2 s, ~17 GB mapped. Start it with
`llm-serve start`; check with `llm-serve which`. From a shell,
`claude local qwen38_27 --think xhigh|medium|low` sets reasoning effort (default xhigh).

## The three ways in

**1. `qwen` CLI.** Works from every harness's shell tool. The local model has no
filesystem access, so attach context explicitly:

```bash
qwen -f src/auth.ts "summarise this module in 5 bullets"
git diff | qwen "write a conventional-commit message"
qwen --think "why would this deadlock?" -f worker.go
```

Thinking is off by default here (~10–20x cheaper); `--think` opts in (effort xhigh).

**2. `local-qwen` subagent.** Delegate via `subagent_type: "local-qwen"` when the
user asked for the local model *and* its output is bulky enough that you only
want the conclusion.

**3. `qwen-code`.** Claude Code's full toolset driven by Qwen, via the
Anthropic→OpenAI proxy. Started by the user from their shell, not by you:

```bash
qwen-code -p "fix the failing lint in src/"
claude local qwen38_27
```

A 3-step edit-and-test task takes ~2 minutes. Fine for background chores; not a
substitute for a frontier model on hard problems.

## When it's not answering

`llm-serve status` shows whether the server and proxy are up and which model is
resident; `llm-serve start` brings it up; `llm-serve logs` tails it. A long generation
can block other requests. Do not start the model inside a task without saying
so: loading takes tens of seconds and uses ~17 GB.
