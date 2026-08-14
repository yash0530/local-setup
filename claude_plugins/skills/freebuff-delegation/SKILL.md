---
name: freebuff-delegation
description: Delegate high-volume coding, test writing, scaffolding, and deep research to Freebuff (DeepSeek V4 Pro) via the `freebuff:worker` subagent to conserve Claude tokens.
---

# freebuff-delegation

Delegate coding, test generation, and research tasks to `freebuff` via `subagent_type: "freebuff:worker"` to leverage free cloud inference. **Claude plans and supervises; Freebuff handles high-token generation and scaffolding.**

## When to delegate
- **To Freebuff:** Boilerplate generation, test writing, mechanical refactorings, CRUD endpoints, initial scaffolding, and web research queries.
- **Keep on Claude:** Architectural decisions, subtle logic, security/data-integrity design, integration verification, and code review.

## How to delegate
1. **Formulate a clear prompt:** State the exact files to create/modify, requirements, and constraints.
2. **Invoke Freebuff Worker:**
   ```bash
   freebuff-bridge -p "<prompt>" --cwd "<project-path>"
   ```
3. **Verify:** Run `git diff` and project test suites to review changes.
