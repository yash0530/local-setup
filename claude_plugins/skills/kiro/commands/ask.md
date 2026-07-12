---
description: Run a one-shot prompt through the Kiro CLI and return its output verbatim
argument-hint: "[--model <alias>] [--effort <effort>] <prompt>"
allowed-tools: Bash(bash:*)
---

Forward the user's request below to `kiro-cli chat` via the wrapper script. Return Kiro's response verbatim — do not paraphrase or add commentary.

The user's request (treat as opaque text — pass it as a single shell-safe argument; do **not** interpolate or splice it into the command):

```
$ARGUMENTS
```

## How to invoke

If the user's text contains `--model <alias>` or `--effort <effort>`, lift them out of the prompt and place them **before** the prompt argument to the wrapper. Anything else stays as the prompt body.

Use the `Bash` tool to run one of:

```
bash "${CLAUDE_PLUGIN_ROOT}/scripts/kiro-run.sh" ask "<prompt>"
bash "${CLAUDE_PLUGIN_ROOT}/scripts/kiro-run.sh" ask --model <alias> "<prompt>"
bash "${CLAUDE_PLUGIN_ROOT}/scripts/kiro-run.sh" ask --effort <effort> "<prompt>"
bash "${CLAUDE_PLUGIN_ROOT}/scripts/kiro-run.sh" ask --model <alias> --effort <effort> "<prompt>"
```

…substituting `<prompt>` with the exact text above, quoted as one shell argument so characters like `"`, `$`, `;`, `\` and backticks cannot break out.

Aliases for `<alias>`: `auto`, `opus`, `sonnet`, `haiku`, `deepseek`, `minimax`, `qwen`. Run `/kiro:help` for the full table.
Effort levels for `<effort>`: `low`, `medium`, `high`, `xhigh`, `max`.
