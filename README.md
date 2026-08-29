# ai-dev-team

A multi-agent development team built on [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness),
orchestrated with Docker Compose. Five DSH agents — **pm**, **backend**,
**frontend**, **tester**, **reviewer** — each run in their own container
with their own isolated workspace, coordinated by a small orchestrator
(PostgreSQL task DB + Redis dispatch queue + HTTP API).

```text
                    local machine
                         │
                 docker compose
                         │
        ┌────────────────┼─────────────────┐
        │                │                 │
        ▼                ▼                 ▼
   dsh-pm           dsh-backend       dsh-frontend
   dsh-tester       dsh-reviewer
   (5 x DSH,        orchestrator      postgres
    same image)     (API :8000)       redis
        │                │
        └────────────────┼─────────────────┘
                         │
              agent runner (node, zero deps)
                         │
                 dsh --profile headless "<task>"
                         │
              git branch ──► PR ──► next agent
```

Each agent container builds DeepSeek Harness **from source, pinned to a
specific commit**, and runs one-shot `headless` sessions (no Web UI).
Agents exchange work exclusively through **Git** — never through shared
files.

## Why this design

- **One Dockerfile, five containers.** `docker/dsh/Dockerfile` builds the
  DSH image once; compose services differ only by `AGENT_ID`,
  `AGENT_ROLE`, and mounts.
- **Pinned DSH.** DSH is a developer preview with frequent breaking
  changes, so `DSH_REF` defaults to a specific commit
  (`cd5ef81`, master @ `0.1.2-alpha.1`). Override with
  `docker compose build --build-arg DSH_REF=<sha>`.
- **Headless profile.** `dsh --profile headless "<task>"` runs one fresh
  persisted session, prints the final answer, and exits `0` on
  `completed` — exactly the shape of a task worker. No browser, no server.
- **Workspace isolation.** `./workspaces/<agent>` is bind-mounted into
  `/workspace/project` of exactly one container. No filesystem sharing
  between agents.
- **Git as the exchange medium.** backend pushes `backend/TASK-007-*`,
  tester checks out that branch, reviewer reviews the PR.

## Directory layout

```text
ai-dev-team/
├── docker-compose.yml        # 8 services: postgres, redis, orchestrator, 5 agents
├── .env.example              # copy to .env; never commit .env
├── Makefile                  # build/up/down/demo helpers
├── docker/dsh/Dockerfile     # shared DSH agent image (pinned commit)
├── agent-runner/             # zero-dep Node runner baked into the image
│   └── runner.js             # register -> heartbeat -> long-poll -> dsh headless
├── agents/
│   ├── pm/AGENTS.md          # role instructions, mounted read-only into
│   ├── backend/AGENTS.md     #   /workspace/project/AGENTS.md of the
│   ├── frontend/AGENTS.md    #   matching container (DSH reads it as
│   ├── tester/AGENTS.md      #   agent instructions)
│   └── reviewer/AGENTS.md
├── workspaces/               # one isolated project copy per agent
│   ├── pm/  backend/  frontend/  tester/  reviewer/
├── orchestrator/             # TypeScript API: task DB + dispatch + registry
│   ├── Dockerfile
│   ├── src/                  # server, db, redis, agents, tasks, events, git
│   └── migrations/           # SQL, applied automatically on boot
└── data/                     # reserved for bind-mount deployments
    ├── postgres/  redis/     #   (compose uses named volumes by default)
```

## Prerequisites

- Docker with the compose v2 plugin
- A DeepSeek API key (`DEEPSEEK_API_KEY`)
- ~4 GB free disk for the DSH image build (clone + `pnpm install` +
  full build; the image is shared by all five agents)

## Quick start

```bash
cp .env.example .env          # set DEEPSEEK_API_KEY
make build                    # docker compose build (long on first run)
make up                       # infra + orchestrator + all 5 agents
docker compose ps
make demo                     # seed a demo project + task graph, dispatch T1
docker compose logs -f dsh-backend dsh-tester
```

`make demo` creates one project and a dependent task graph
(backend skeleton → frontend shell + QA test plan → review), then
dispatches the first task. When backend finishes, the orchestrator
**auto-dispatches** the unblocked dependents.

### Prove the chain manually first

Before trusting the orchestrator, verify the core chain
**Docker → DSH → headless → DeepSeek API → workspace**:

```bash
docker compose exec dsh-backend bash
cd /workspace/project
dsh --profile headless "Inspect the repository and describe the backend architecture. Do not modify files."
```

`dsh` is on `PATH` (`/opt/deepseek-harness/node_modules/.bin`), and the
invoking directory is the workspace root. `DEEPSEEK_API_KEY` is already
in the container environment.

## How a task flows

```text
PM / curl
   │  POST /api/tasks {project_id, title, assigned_agent: "backend", depends_on: [...]}
   ▼
tasks (postgres)                     POST /api/tasks/:id/dispatch
   │                                         │
   ▼                                         ▼
orchestrator ── insert agent_run (pending)   agent_runs: pending
   │            task -> in_progress          task: in_progress
   │
   ▼  GET /agents/backend/next  (runner polls; orchestrator claims
agent runner                             the next pending run atomically)
   │  claim run -> running
   │  dsh --profile headless "<prompt>"
   │  (prompt: task + branch backend/TASK-007-* + git rules)
   ▼
workspace /workspace/project ── git init/remote ── branch ── commit ── push ── PR
   │
   ▼  POST /agents/backend/runs/7/result {status, exit_code, output, branch, pr_url}
orchestrator ── run: succeeded, task: done
   │  └─ dependents with all prerequisites done are dispatched automatically
   ▼
events (postgres + redis pub/sub events:all)
```

**Dispatch state lives in PostgreSQL** (source of truth): `POST /tasks/:id/dispatch` inserts a `pending` run, and the runner's `GET /agents/:id/next` claims it atomically (`pending` → `running`). Redis is the **event bus only** (`events:all` pub/sub) — no blocking queue commands, so a wedged Redis cannot stall dispatch, and the agent runner never needs Redis credentials. (The earlier BRPOP-queue design was dropped after a smoke test showed a shared ioredis connection serializing all commands behind 25s blocking pops.)

### API summary

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/projects` | create a project |
| GET | `/api/projects` | list projects |
| POST | `/api/tasks` | create a task (`depends_on` supported) |
| GET | `/api/tasks?status=&agent=&project_id=` | list tasks |
| GET | `/api/tasks/:id` | task + dependencies |
| POST | `/api/tasks/:id/dispatch` | queue the task for its agent |
| POST | `/api/agents/register` | agent self-registration (runner) |
| GET | `/api/agents` | agent registry + status |
| POST | `/api/agents/:id/heartbeat` | heartbeat (runner, every 15s) |
| GET | `/api/agents/:id/next` | claim next dispatched task, up to ~10s wait (runner) |
| POST | `/api/agents/:id/runs/:runId/result` | run result ingestion (runner) |
| POST | `/api/events` | record an event |
| GET | `/api/events?limit=` | recent events |
| GET | `/healthz` | liveness (DB check; compose healthcheck) |

## Data model

`agents`, `projects`, `tasks`, `task_dependencies`, `agent_runs`,
`pull_requests`, `events` — see `orchestrator/migrations/001_init.sql`.
Migrations run automatically on orchestrator boot (idempotent).

## Security notes

- **Never commit `.env`.** It holds `DEEPSEEK_API_KEY`.
- **Agent containers run as root** (`user: "0:0"` in compose). On
  Docker Desktop (Windows/macOS) bind mounts appear root-owned inside
  the VM, so the image's uid-1000 `dsh` user would get `EACCES`
  writing the workspace. Acceptable for this prototype because each
  agent is isolated by its own container and workspace; revisit
  before any multi-tenant deployment.
- **Pin `DSH_REF`.** The Dockerfile defaults to the commit this scaffold
  was written against; for production set it explicitly
  (`DSH_REF=<commit-sha>` in `.env` or `--build-arg`) so every agent runs
  the same DSH.
- **Prototype credentials.** All agents currently share the same
  `GITHUB_TOKEN` (GitHub requires credentials to push branches/PRs).
  Before anything serious: move to a **credential broker** — agents
  request scoped permissions from the orchestrator instead of holding a
  repository-wide token (see `orchestrator/src/git.ts` as the extension
  point).
- Postgres/Redis are **not exposed** to the host. Only the orchestrator
  API is published (`localhost:8000`).

## Troubleshooting

- `dsh --profile headless` exits `1`: the run failed (model error, tool
  error, or missing key). Check `docker compose logs dsh-<agent>` and
  `workspaces/<agent>/.agent-team/runs/run-<id>.log`.
- Agents never pick up tasks: check `docker compose logs dsh-backend` —
  the runner logs registration, heartbeats, and polls.
- `make demo` re-run: the seed is idempotent (project and tasks are
  re-created; already-dispatched tasks are left alone).
- Build fails on `pnpm install`: the DSH image build needs network access
  to npm/GitHub; retry with `docker compose build --no-cache` if a
  transient failure left partial layers.
- `ERR_PNPM_IGNORED_BUILDS` while building the orchestrator: pnpm 11
  fails hard on unlisted build scripts (`strictDepBuilds`). The
  allowlist lives in `orchestrator/pnpm-workspace.yaml`
  (`allowBuilds: esbuild: true`) and the Dockerfile copies it into both
  stages — if you move/rename that file, keep them in sync.

## Next steps (not implemented yet)

1. **Credential broker** — scoped git permissions per agent instead of a
   shared token.
2. **Task tracker adapter** — the orchestrator's task DB is the system of
   record; Redmine/Jira/GitHub Issues can be added as adapters without
   touching the DSH agents.
3. **Railway deployment** — the compose services map 1:1 to Railway
   services; keep workspace isolation and pinned DSH.
