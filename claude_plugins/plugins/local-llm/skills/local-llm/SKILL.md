---
name: local-llm
description: "Reference for the local Qwen 3.8 27B model (llama-server GGUF or LM Studio Splash) — how to start/switch them and the three ways to reach them. OPT-IN ONLY: read this when the user explicitly asks about or for the local model ('ask qwen', 'use the local model', 'llm-serve', 'qwen-code'). This skill does NOT authorise routing work to local models on your own judgement — never do that."
---

# local-llm

Qwen 3.8 27B can be served locally, by `llama-server` (GGUF) or LM Studio's
Splash engine (4-bit). This skill is **reference material for when the user asks
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

## Pick the model (when asked)

| | `splash4` (LM Studio Splash, 4-bit) | `gguf5` (llama.cpp, 5-bit) |
|---|---|---|
| decode | **~35–84 tok/s** | ~13–20 tok/s |
| warm follow-up | **1–2 s** | ~8 s |
| resident | ~17 GB mapped | ~38 GB |

Only one model is resident at a time, so switching *replaces* it:
`llm-serve start splash4` or `llm-serve start gguf5`. Check with `llm-serve which`.

Model aliases: `splash4` (4-bit on LM Studio Splash) · `gguf5` / `gguf6` / `gguf8`
(llama.cpp). From a shell, `claude local qwen38_27 --bits 4` picks Splash and
`--bits 5|6|8` pins a GGUF; `--think xhigh|medium|low` sets reasoning effort
(default xhigh).

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
claude local qwen38_27 --bits 4
```

A 3-step edit-and-test task takes ~2 minutes. Fine for background chores; not a
substitute for a frontier model on hard problems.

## When it's not answering

`llm-serve status` shows whether the server and proxy are up and which model is
resident; `llm-serve start` brings it up; `llm-serve logs` tails it. Note `-np 1`
— one request at a time, so a long generation blocks everything else. Do not
start or switch models inside a task without saying so: loading takes tens of
seconds and evicts the other model.
