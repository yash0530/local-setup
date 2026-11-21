---
name: local-llm
description: "Reference for the local coding models (Ornith-1.5-35B-A3B, Inkling-2-Mini oQ3e, DaisyRose-27B via oMLX; Qwen 3.8 27B Splash4 via LM Studio) — how to start them and the three ways to reach them. OPT-IN ONLY: read this when the user explicitly asks about or for the local model ('ask qwen', 'use the local model', 'llm-serve', 'qwen-code'). This skill does NOT authorise routing work to local models on your own judgement — never do that."
---

# local-llm

Four local coding models can be served on Apple Silicon (oMLX v0.8.1 + LM Studio Splash). This skill is **reference material for when the user asks
for it** — it is not a suggestion to use it.

## Routing policy (the important part)

**Never send work to the local model unless the user explicitly asked in the
current request.** This setup exists for deliberate experimentation with local
models. The user pays for a Claude subscription and expects that quality by
default; silently substituting a local model degrades their real work.

Concretely:

- A task being bulky, repetitive, or "cheap enough for a small model" is **not**
  a reason to route it locally. Do it yourself.
- Do not suggest offloading to the local model unprompted.
- The `local-qwen` subagent and the `qwen` CLI are opt-in tools, not defaults.

Explicit triggers look like: "ask qwen…", "use the local model", "run this
locally", "use local-qwen", "test this on ornith/inkling2/qwen".

## The models (default `--think xhigh`)

- **`ornith35` (default):** `Ornith-1.5-35B-A3B-oQ4e-mtp` on `oMLX v0.8.1` — fastest overall (`~87–104 tok/s`, `0.61s` warm follow-ups, `5/5` Tier 4 + `8/8` deep recall). Launch: `claude local ornith` or `llm-serve start ornith35`.
- **`inkling2`:** Thinking Machines `Inkling-2-Mini-oQ3e-mtp` on `oMLX v0.8.1` + DSpark (`MLX_ENABLE_TF32=0`, `ctx 131072`) — `5/5` Tier 4 + `8/8` deep recall at `~66 tok/s`. Launch: `claude local inkling2`.
- **`daisyrose27`:** `DaisyRose-27B-oQ4e-mtp` (pure-RL Qwen 3.8 27B) on `oMLX v0.8.1` (`ctx 131072`) — `5/5` Tier 4 (`0` timeouts). Launch: `claude local daisyrose`.
- **`splash4`:** `incoai/Qwen3.8-27B-Splash` (4-bit + DFlash2) on LM Studio Splash — legacy fast baseline (`~44–74 tok/s`, `1.0s` warm). Launch: `claude local qwen38_27`.

Start any model with `llm-serve start <alias>`; check with `llm-serve which`. `--think` sets reasoning effort (default `xhigh`).

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
