---
description: Show all /kiro:* commands, supported --model aliases, and effort levels
allowed-tools: Bash(bash:*)
---

Run the wrapper's help branch, then print its stdout verbatim as a fenced code block in your text response. Do not paraphrase, reorder, or summarize.

```
bash "${CLAUDE_PLUGIN_ROOT}/scripts/kiro-run.sh" help
```

After the Bash call completes, copy the full stdout into your response inside a ``` code block.
