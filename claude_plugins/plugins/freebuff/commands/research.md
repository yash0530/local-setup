---
description: Perform deep web-augmented research on technical topics, model comparisons, or specifications via Freebuff.
argument_names:
  - topic
---

Run a deep research query using Freebuff's multi-agent web retrieval engine:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/freebuff-run.sh" research "Perform a deep research analysis on: $ARG_TOPIC. Compile full findings with benchmarks and technical specifications." "$(pwd)" 150
```
