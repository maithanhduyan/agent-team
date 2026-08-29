# agents/ — role instructions

Each subdirectory holds the `AGENTS.md` for one agent role. Compose
mounts the matching file **read-only** over the workspace root of its
container:

```text
./agents/backend/AGENTS.md  ->  dsh-backend  ->  /workspace/project/AGENTS.md (ro)
```

DeepSeek Harness reads `AGENTS.md` from the workspace root as agent
instructions, so every `dsh --profile headless` run in that container
operates under its role rules.

| Role file                | Agent id    | Mounted into       |
|--------------------------|-------------|--------------------|
| `pm/AGENTS.md`           | `pm`        | `dsh-pm`           |
| `ba/AGENTS.md`           | `ba`        | `dsh-ba`           |
| `backend/AGENTS.md`      | `backend`   | `dsh-backend`      |
| `frontend/AGENTS.md`     | `frontend`  | `dsh-frontend`     |
| `tester/AGENTS.md`       | `tester`    | `dsh-tester`       |
| `reviewer/AGENTS.md`     | `reviewer`  | `dsh-reviewer`     |
| `cto/AGENTS.md`          | `cto`       | `dsh-cto`          |
| `owner/AGENTS.md`        | `owner`     | `dsh-owner` (web UI, not dispatched) |

`owner` is the business-owner assistant: it serves the interactive DSH
Web UI (see README "Business owner") and is the only agent that is NOT
dispatched by the orchestrator.
