---
description: Delegate a thorough research investigation to the kiro:runner subagent
argument-hint: "[--background] [--model <alias>] [--effort <effort>] <topic or question>"
allowed-tools: Agent
---

Hand a deep-research task to the `kiro:runner` subagent (`subagent_type: "kiro:runner"`).

Wrap the user's topic in a research-oriented preamble so `kiro-cli` treats it as a structured investigation rather than a quick Q&A.

Raw user request:
$ARGUMENTS

## How to forward

Build the research prompt for the subagent as:

```
Conduct a thorough research investigation on the following topic. Look up authoritative sources, summarize the current state of knowledge, surface disagreements or open questions, and structure the response with clear sections (Background, Key findings, Caveats, Sources).

Topic: <stripped user request here>
```

(Strip any routing flags — `--background`, `--model <alias>`, `--effort <effort>` — from the topic text before injecting it.)

Then invoke the `kiro:runner` subagent with that prompt as `subagent_type: "kiro:runner"`.

## Routing rules

- If the request contains `--background`, launch the subagent with `run_in_background: true`. Research is often long-running — prefer background unless the user explicitly asked for foreground.
- If the request contains `--model <alias>`, forward it to the subagent so it can be appended to the wrapper call as `--model <alias>` (placed **before** the prompt argument).
- If the request contains `--effort <effort>`, forward it to the subagent so it can be appended to the wrapper call as `--effort <effort>` (placed **before** the prompt argument).

Aliases: `auto`, `opus`, `sonnet`, `haiku`, `deepseek`, `minimax`, `qwen`. Run `/kiro:help` for the full table.
Effort levels: `low`, `medium`, `high`, `xhigh`, `max`.

## Response style

Return the subagent's output verbatim — no extra commentary before or after.

If the user did not supply a topic, ask what they want researched.
