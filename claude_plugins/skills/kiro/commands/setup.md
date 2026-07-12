---
description: Verify the Kiro CLI (`kiro-cli`) is installed and authenticated
allowed-tools: Bash(bash:*), AskUserQuestion
---

Run:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/kiro-run.sh" check
```

Then interpret the JSON output:

- If `installed: false`, explain that `/kiro:ask`, `/kiro:delegate`, and `/kiro:review` will fail until Kiro CLI is installed.
- If `installed: true` but `auth: missing`, tell the user to run `kiro-cli login` in their terminal to authenticate.
- If `installed: true` and `auth` is `logged-in`, report that everything is ready — one short status line is enough.
