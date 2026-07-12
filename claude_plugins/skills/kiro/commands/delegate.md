---
description: Delegate a task to the Kiro (`kiro`) runner subagent; supports background execution, model and effort selection
argument-hint: "[--background] [--model <alias>] [--effort <effort>] <task description>"
allowed-tools: Agent
---

Hand the user's task to the `kiro:runner` subagent (`subagent_type: "kiro:runner"`).

Raw user request:
$ARGUMENTS

## Routing rules

- If the request contains `--background`, launch the subagent with `run_in_background: true`. Strip the flag from the forwarded task text.
- Otherwise run the subagent in the foreground.
- If the request contains `--model <alias>`, forward it to the subagent so it can be appended to the wrapper call as `--model <alias>` (placed **before** the prompt argument). Strip it from the task text.
- If the request contains `--effort <effort>`, forward it to the subagent so it can be appended to the wrapper call as `--effort <effort>` (placed **before** the prompt argument). Strip it from the task text.

Aliases for `<alias>`: `auto`, `opus`, `sonnet`, `haiku`, `deepseek`, `minimax`, `qwen`. Run `/kiro:help` for the full table.
Effort levels for `<effort>`: `low`, `medium`, `high`, `xhigh`, `max`.

## Response style

The subagent is a thin wrapper around `kiro-cli`. Return its output verbatim — no extra commentary before or after.

If the user did not supply a task, ask what they would like Kiro to do.
