---
description: Delegate a coding, refactoring, or test generation task to Freebuff.
argument_names:
  - task
---

Delegate a coding or scaffolding task to Freebuff:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/freebuff-run.sh" delegate "$ARG_TASK" "$(pwd)" 180
```

After Freebuff completes:
1. Run `git status` and `git diff` to review all changes.
2. Run test suites to verify correctness.
