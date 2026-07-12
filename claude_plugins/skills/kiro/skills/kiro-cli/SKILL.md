---
name: kiro-cli
description: Internal runtime contract for invoking the Kiro CLI (`kiro-cli`) from the `kiro` subagent. Not user-invocable.
user-invocable: false
---

# Kiro CLI runtime

Use this skill only inside the `kiro` subagent.

## Primary helper

```
bash "${CLAUDE_PLUGIN_ROOT}/scripts/kiro-run.sh" ask [--model <alias>] [--effort <effort>] "<prompt>" [kiro-flags...]
```

The wrapper:

- Locates `kiro-cli` in `PATH`, `~/.local/bin`, `/usr/local/bin`, or `/opt/kiro/bin`.
- Verifies auth (`kiro-cli whoami`).
- Runs `kiro-cli chat "<prompt>" --no-interactive`.
- Cleans output to strip leading/trailing metadata.

## Rules of engagement

One wrapper call per task. The subagent is a forwarder, not an orchestrator — keep the user's task text intact and let `kiro-cli` do the work.

Strip flags that belong to the parent slash command (`--background`) before forwarding. Pass `--model <alias>` and `--effort <effort>` to the wrapper.
