# ai-dev-team

A multi-agent development team built on [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness),
orchestrated with Docker Compose. Eight DSH agents — **pm**, **ba**,
**backend**, **frontend**, **tester**, **reviewer**, **cto**,
**accountant** — each run
in their own container with their own isolated workspace, coordinated
by a small orchestrator (PostgreSQL task DB + Redis dispatch queue +
HTTP API). The **business owner** interacts through a chat command
center (DSH Web UI) and a task-board dashboard.

```text
                    local machine
                         │
                 docker compose
                         │
        ┌────────────────┼──────────────────┐
        │                │                  │
        ▼                ▼                  ▼
   dsh-pm  dsh-ba  dsh-backend        dsh-owner (web UI :3080)
   dsh-frontend dsh-tester        dashboard (task board :8080)
   dsh-reviewer dsh-cto
   dsh-accountant (Odoo MCP)
   (8 x DSH,     orchestrator      postgres
    same image)  (API :8000)       redis
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
files. The `dsh-owner` container is the exception: it serves the DSH
**Web UI interactively** for the business owner.

## Why this design

- **One Dockerfile, eight containers.** `docker/dsh/Dockerfile` builds the
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
- **Redmine as the human layer.** A Redmine instance (issues, wiki,
  Gantt, time tracking) gives humans a classic project-management UI at
  `http://localhost:3000`; the pm/ba/tester/cto agents reach it through
  an MCP bridge (`redmine-mcp`) and `mcp__redmine__*` tools. The
  orchestrator task DB stays the system of record for agent work.

## Directory layout

```text
ai-dev-team/
├── docker-compose.yml        # 19 services: postgres, redis, orchestrator, dashboard, owner,
│                             #   redmine-db, redmine, redmine-mcp, playwright-mcp,
│                             #   github-mcp, odoo-mcp, 8 agents
├── .env.example              # copy to .env; never commit .env
├── Makefile                  # build/up/down/demo helpers
├── docker/dsh/Dockerfile     # shared DSH agent image (pinned commit)
├── docker/odoo-mcp/Dockerfile# Odoo MCP bridge image (pinned odoo-mcp)
├── agent-runner/             # zero-dep Node runner baked into the image
│   ├── runner.js             # register -> heartbeat -> long-poll -> dsh headless
│   └── web-proxy.cjs         # loopback -> eth0 proxy for the owner web UI
├── agents/
│   ├── pm/AGENTS.md          # role instructions, mounted read-only into
│   ├── ba/AGENTS.md          #   /workspace/project/AGENTS.md of the
│   ├── backend/AGENTS.md     #   matching container (DSH reads it as
│   ├── frontend/AGENTS.md    #   agent instructions)
│   ├── tester/AGENTS.md
│   ├── reviewer/AGENTS.md
│   ├── cto/AGENTS.md
│   ├── accountant/AGENTS.md  # monthly closing reports from Odoo
│   ├── owner/AGENTS.md       # business-owner assistant (web UI)
│   ├── shared/
│   │   ├── cordis.patch.yml  # DSH home-level patch layer: attaches the Redmine MCP
│   │   │                     #   server via @deepseek-ai/dsh-mcp-client; mounted at
│   │   │                     #   /home/dsh/.dsh/cordis.patch.yml of pm/ba/tester/cto/owner
│   │   ├── github.patch.yml  # GitHub MCP attach for backend/frontend/reviewer
│   │   └── odoo.patch.yml    # Odoo MCP attach for the accountant agent
│   └── skills/
│       ├── git-branching/SKILL.md  # GIT BRANCHING SKILL (Git Flow model,
│       │                           #   git-flow commands + manual
│       │                           #   equivalents), mounted read-only into
│       │                           #   /workspace/project/.dsh/skills/...
│       │                           #   of every agent container (DSH
│       │                           #   auto-discovers project skills there;
│       │                           #   AGENTS.md points each agent at it)
│       ├── github-workflow/SKILL.md # PR/issues workflow for dev agents
│       ├── ui-testing/SKILL.md      # Playwright UI test workflow (tester)
│       └── monthly-closing/SKILL.md # MONTHLY CLOSING SKILL: Odoo data
│                                    #   pulls, VAS report mapping, checklist
│                                    #   (accountant)
├── dashboard/                # task board (nginx + static single-file UI)
│   ├── nginx.conf            # proxies /api to the orchestrator
│   └── html/index.html       # board: projects/tasks/agents/events
├── frontend/                 # product frontend: Vite + React + TS app shell
│   ├── package.json          #   dev/build/test scripts (see frontend/README.md)
│   └── src/                  #   routes, app shell layout, pages
├── scripts/                  # host-side triggers (monthly closing, ...)
│   ├── monthly-close.ps1     #   create + dispatch the accountant task
│   └── monthly-close.sh      #   (PowerShell / bash for cron scheduling)
├── workspaces/               # one isolated project copy per agent
│   ├── pm/  ba/  backend/  frontend/  tester/  reviewer/  cto/
│   ├── accountant/  owner/
├── orchestrator/             # TypeScript API: task DB + dispatch + registry
│   ├── Dockerfile
│   ├── src/                  # server, db, redis, agents, tasks, events, git
│   └── migrations/           # SQL, applied automatically on boot
└── data/                     # reserved for bind-mount deployments
    ├── postgres/  redis/     #   (compose uses named volumes by default)
```

## Frontend app

The product frontend lives in `frontend/` — a Vite + React + TypeScript
single-page app with an app shell (header / main / footer) and React Router
client-side routing. The placeholder home page is served at `/`; unknown paths
fall back to a 404 page. See `frontend/README.md` for details.

```bash
cd frontend
npm ci              # install from the committed lockfile
npm run dev         # dev server → http://localhost:5173
npm test            # Vitest component/interaction tests
npm run build       # type-check + production build → dist/
```

## Prerequisites

- Docker with the compose v2 plugin
- A DeepSeek API key (`DEEPSEEK_API_KEY`)
- ~4 GB free disk for the DSH image build (clone + `pnpm install` +
  full build; the image is shared by all eight agents)

## Quick start

```bash
cp .env.example .env          # set DEEPSEEK_API_KEY
make build                    # docker compose build (long on first run)
make up                       # infra + orchestrator + all 8 agents
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

## Business owner: how to interact with the team

The owner (the human CEO) has two entry points — no curl needed:

1. **Command center (chat)** — `dsh-owner` serves the DSH Web UI at
   `http://localhost:3080`. Chat in plain language ("thêm tính năng X
   cho khách hàng…"); the owner assistant answers in your language and
   turns intent into tasks through the orchestrator API.

   First visit needs the one-time access token printed at boot:

   ```bash
   docker logs dsh-owner 2>&1 | grep -o 'http://127.0.0.1:3080/?token=[A-Za-z0-9_-]*' | tail -1
   # open that URL (swap 127.0.0.1 for localhost), it mints a 30-day cookie
   ```

2. **Task board** — `http://localhost:8080`: live view of projects,
   tasks (todo / in_progress / done / failed / blocked), agents, and
   events; create + dispatch tasks from the UI. The board proxies
   `/api` to the orchestrator through nginx (no CORS needed).

Role flow: owner → **ba** (business analyst: user stories + acceptance
criteria) → **pm** (breaks down + dispatches) → **backend/frontend**
(implement) → **tester** (verify) → **reviewer** (PR review) + **cto**
(architecture review, release gate). Separately, **accountant**
produces the monthly closing report pack from Odoo on schedule (see
[Monthly closing from Odoo](#monthly-closing-from-odoo-accountant-agent)).

## Redmine integration

**Why:** the orchestrator task DB remains the system of record for
agent work; Redmine is the human-facing project-management layer
(issues, wiki, Gantt, time tracking) at `http://localhost:3000`.

**How agents connect (MCP):** DSH ships an MCP client plugin
(`@deepseek-ai/dsh-mcp-client`, no extra install). The shared patch
layer `agents/shared/cordis.patch.yml` is mounted read-only at
`/home/dsh/.dsh/cordis.patch.yml` of `dsh-pm`, `dsh-ba`, `dsh-tester`,
`dsh-cto`, and `dsh-owner`; DSH applies it to every profile (headless
runner + owner web UI). It attaches one MCP server:

```yaml
- insert:
    - id: mcp-redmine
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: redmine
        transport: streamable-http
        url: http://redmine-mcp:8000/mcp
```

Tools appear in agent sessions as `mcp__redmine__<tool>` (e.g.
`mcp__redmine__create_redmine_issue`, `mcp__redmine__list_redmine_issues`,
`mcp__redmine__manage_redmine_wiki_page`, `mcp__redmine__get_gantt_chart`).
The bridge `redmine-mcp` ([redmine-mcp-server](https://github.com/jztan/redmine-mcp-server),
MIT, pinned tag) holds the Redmine API key — **agents never see
credentials**. A down Redmine/MCP never blocks agents: the mcp-client
defaults to `failOnStartupError: false` with auto-reconnect, so tools
simply disappear until the bridge recovers.

**One-time setup (manual, ~2 minutes):**

1. `cp .env.example .env` and set `REDMINE_DB_PASSWORD`,
   `REDMINE_SECRET_KEY` (`openssl rand -hex 32`).
2. `docker compose up -d redmine` — first boot runs DB migrations.
3. Open `http://localhost:3000`, sign in as `admin` / `admin`, change
   the password.
4. Administration → Settings → API → enable **Enable REST API**.
5. My account → API access key → create one, put it in `REDMINE_API_KEY`
   in `.env` (or from the container:
   `docker compose exec redmine bundle exec rails runner "puts User.find_by(login: 'admin').api_key"`).
6. `docker compose up -d redmine-mcp` — verify the bridge is healthy:
   `docker compose ps` and `docker compose logs redmine-mcp`.

**Mapping convention:** each orchestrator task that matters to humans
maps to exactly one Redmine issue; the pm/ba/tester agents record
`Redmine issue: #<id>` in the task description so the mapping is
traceable both ways (rules live in each agent's `AGENTS.md`).

**REST API fallback:** `curl` is already installed in the agent image;
Redmine's built-in REST API ([docs](https://www.redmine.org/projects/redmine/wiki/Rest_api))
is reachable from any container with `REDMINE_URL`/`REDMINE_API_KEY`
set, using the `X-Redmine-API-Key` header. The MCP bridge is the
recommended path; the API is the lightweight fallback for ad-hoc
queries.

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

## Pushing to GitHub (git integration)

Agents push branches and open PRs only when the project has a
`repository_url` — the orchestrator embeds it in the task prompt, and
the runner configures the workspace's `origin` remote automatically
(no manual `git remote add` needed).

To enable it:

1. Fill `GITHUB_TOKEN` in `.env` (fine-grained PAT with `Contents:
   Read and write` on the target repo — see
   `agents/skills/git-branching/SKILL.md` for the PR API call).
2. Fill `SEED_REPOSITORY_URL=https://github.com/<owner>/<repo>.git`
   in `.env` (clean URL — **no token inside**; the runner injects
   `https://x-access-token:<token>@...` into the workspace's git
   config at run time, so the token never lands in the DB or logs).
3. `docker compose up -d` then `make demo` (or re-run `make demo`
   later — the seed updates `repository_url` on an existing project).
4. Watch pushes/PRs in `docker compose logs -f dsh-backend`.

For a project created via `POST /api/projects`, pass `repository_url`
in the body instead; agents still get the remote + credential
injection through the same runner path.

## MCP integrations

Every DSH agent can attach MCP servers through a DSH home-level patch
mounted at `$DSH_HOME/cordis.patch.yml`; tools appear as
`mcp__<serverName>__<tool>`. All bridges fail open
(`failOnStartupError: false`) so a down server never blocks an agent
from booting.

| Bridge | Server | Consumers | Tools |
|---|---|---|---|
| Redmine | `redmine-mcp` (streamable-http :8000) | pm, ba, tester, cto, owner | `mcp__redmine__*` — issues, trackers, statuses |
| Playwright | `playwright-mcp` (streamable-http :8931) | tester | `mcp__playwright__browser_*` — navigate, snapshot, click, type, verify, screenshot (headless Chromium) |
| GitHub | `github-mcp` (streamable-http :8989, official server, digest-pinned) | backend, frontend, reviewer | `mcp__github__*` — PRs, issues, repos, Actions (Bearer auth via the patch's `!!js` env read; token never written to disk in the patch) |
| Odoo | `odoo-mcp` (streamable-http :8000, `docker/odoo-mcp/Dockerfile`, pinned `odoo-mcp` PyPI version) | accountant | `mcp__odoo__*` — search/read/aggregate records, AR/AP aging, accounting health, profile (read-only; bridge holds `ODOO_*` credentials) |

Playwright details:

- Image `ai-team/playwright-mcp:local` builds from
  `docker/playwright-mcp/Dockerfile` (@playwright/mcp pinned, Chromium
  + system deps, headless, `--isolated`, `--caps testing`).
- Screenshots are written to `workspaces/tester/artifacts/`, which is
  mounted into the tester's workspace at `artifacts/` — the tester
  commits them as PR evidence. Workflow: see
  `agents/skills/ui-testing/SKILL.md`.
- The app under test runs inside the tester's workspace (the tester
  checks out the frontend branch, starts a dev server detached with
  `setsid`, and verifies it with `curl` before driving the browser).

GitHub details:

- `github-mcp` holds `GITHUB_TOKEN` as
  `GITHUB_PERSONAL_ACCESS_TOKEN`; agents authenticate with the same
  token through the `Authorization` header injected by
  `agents/shared/github.patch.yml` (`!!js` expression reading
  `process.env.GITHUB_TOKEN` at boot — the patch file itself never
  contains the token).
- Workflow: see `agents/skills/github-workflow/SKILL.md`.

Odoo details:

- `odoo-mcp` (package [`odoo-mcp`](https://pypi.org/project/odoo-mcp/),
  MIT, built from `docker/odoo-mcp/Dockerfile` at a pinned version)
  holds `ODOO_URL` / `ODOO_DB` / `ODOO_USERNAME` / `ODOO_PASSWORD`;
  the accountant agent reaches Odoo through read-only
  `mcp__odoo__*` tools and never sees the credentials.
- Transport: XML-RPC for Odoo 16-18 (default), External JSON-2 for
  Odoo 19+ (`ODOO_TRANSPORT=json2` + `ODOO_API_KEY`).
- Writes are disabled on the bridge by design
  (`ODOO_MCP_ENABLE_WRITES` never set) — the accountant is read-only.
- Workflow: see `agents/skills/monthly-closing/SKILL.md`.

## Monthly closing from Odoo (accountant agent)

The `dsh-accountant` agent produces the **monthly closing report
pack** from Odoo on a schedule: P&L (Báo cáo kết quả kinh doanh),
balance sheet summary (Bảng cân đối kế toán), VAT summary (Tờ khai
GTGT), trial balance CSV, AR/AP aging, and a validated closing
checklist — delivered **in the accountant's workspace only** (draft
material for the human accountant; the official declarations are
still filed by humans). The pack contains confidential business data
and is **never committed or pushed to git** — see
[`SECURITY.md`](SECURITY.md) and [`CONDUCT.md`](CONDUCT.md) for the
agent security policy and professional conduct rules.

- The closing procedure (data pulls, VAS report mapping, checklist,
  templates) is documented in **MONTHLY CLOSING SKILL**
  (`agents/skills/monthly-closing/SKILL.md`), mounted read-only into
  the accountant's workspace.
- **Triggering:** the orchestrator has no scheduler, so a host-side
  trigger creates + dispatches the task:
  `scripts/monthly-close.ps1` / `scripts/monthly-close.sh`
  (idempotent: skips periods already queued). Wire it to Windows
  Task Scheduler or cron on the 1st of each month; the runner polls
  continuously, so the task is picked up immediately.
- **Setup:** fill the `ODOO_*` block in `.env`, start the stack, and
  verify the bridge — full guide in
  [`docs/ODOO-MONTHLY-CLOSING.md`](docs/ODOO-MONTHLY-CLOSING.md).

## Project management loop (Redmine ↔ Orchestrator)

Two-way sync makes Redmine the human front-end for the team's work:

- **Redmine → orchestrator** (poller, every 30s): open issues of the
  Redmine project whose subject follows `[<agent>] <title>` (agent ∈
  pm/ba/frontend/backend/tester/reviewer/cto/owner) are imported as
  tasks and the issue moves to *In Progress*. Import is idempotent
  and never auto-dispatches — dispatch stays a human/PM/owner
  decision.
- **orchestrator → Redmine** (on run result): the linked issue is
  closed (`succeeded`) or rejected (`failed`) with a note carrying
  the summary, branch and PR URL.
- Needs `REDMINE_API_KEY` in `.env` (passed to the orchestrator);
  sync is disabled without it and is always fail-open.
- Tracker "Task" (id 4) is the import source; see
  `orchestrator/src/redmine.ts` and `migrations/002_redmine_sync.sql`.

## Compose layout

`docker-compose.yml` was split into layers (Compose `include` +
profiles) so the stack can be started partially:

| File | Contents | Profile |
|---|---|---|
| `compose.yaml` | postgres, redis, orchestrator, dashboard, dsh-owner | (always on) |
| `compose.agents.yaml` | 8 headless agents (pm/ba/backend/frontend/tester/reviewer/cto/accountant) | `--profile agents` |
| `compose.integrations.yaml` | redmine, redmine-mcp, playwright-mcp, github-mcp, odoo-mcp | `--profile integrations` |

Full stack: `docker compose --profile agents --profile integrations up -d`
(or `make up`). Core only: `docker compose up -d`.

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
- **Unconfined agent shell.** The agent image ships no sandbox backend
  (bubblewrap/Landlock), and DSH fails closed for confined modes — so
  the compose services set `DSH_PERMISSION_MODE=danger-full-access`,
  letting agents run `bash` (git, curl) unconfined with approval
  policy `never`. That is acceptable only because every agent is
  already isolated by its own container and workspace; never expose
  these containers to untrusted workloads.
- **Pin `DSH_REF`.** The Dockerfile defaults to the commit this scaffold
  was written against; for production set it explicitly
  (`DSH_REF=<commit-sha>` in `.env` or `--build-arg`) so every agent runs
  the same DSH.
- **Prototype credentials.** All agents currently share the same
  `GITHUB_TOKEN` (GitHub requires credentials to push branches/PRs).
  The runner injects it into each workspace's `.git/config` (as
  `https://x-access-token:<token>@...`) — the token is never stored in
  the DB or run logs, but it **is** written to the bind-mounted
  workspace on the host. Keep workspaces out of any shared backup or
  repo until this is replaced. Before anything serious: move to a
  **credential broker** — agents request scoped permissions from the
  orchestrator instead of holding a repository-wide token (see
  `orchestrator/src/git.ts` as the extension point).
- **Odoo credentials.** `ODOO_PASSWORD` / `ODOO_API_KEY` live only in
  `.env` and inside the `odoo-mcp` container — never in the DB, run
  logs, or agent workspaces. The bridge is internal-only (not
  published to the host) and read-only (`ODOO_MCP_ENABLE_WRITES` is
  never set). Prefer a dedicated low-privilege Odoo user (Accounting
  app read access) over the admin account.
- **Business data.** Closing report packs contain confidential
  financial data and are workspace-local by policy: agents never
  commit or push them (enforced in AGENTS.md, the MONTHLY CLOSING
  SKILL, and the orchestrator prompt for the accountant agent). See
  `SECURITY.md` (data policy + incident log) and `CONDUCT.md`
  (professional ethics) — every agent must follow them.
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
- Agents never show `mcp__redmine__*` tools: check that
  `agents/shared/cordis.patch.yml` is mounted
  (`docker compose exec dsh-pm ls -la /home/dsh/.dsh/cordis.patch.yml`),
  that `redmine-mcp` is healthy (`docker compose ps redmine-mcp`,
  `docker compose logs redmine-mcp`), and that `REDMINE_API_KEY` is set
  in `.env` (restart `redmine-mcp` after changing it).
- Agents never show `mcp__odoo__*` tools: same recipe — check
  `agents/shared/odoo.patch.yml` is mounted on `dsh-accountant`,
  `docker compose ps odoo-mcp` (healthy), `docker compose logs
  odoo-mcp`, and the `ODOO_*` vars in `.env` (restart `odoo-mcp`
  after changing them). If the bridge logs show **HTTP 421**, the
  FastMCP host allowlist rejected the client's `Host` header — keep
  `MCP_ALLOWED_HOSTS` (compose.integrations.yaml) in sync. Odoo in a
  separate compose project needs `docker network connect
  <net> ai-team-odoo-mcp` + `ODOO_URL=http://odoo:8069` (see
  `scripts/odoo-network.ps1` and
  [`docs/ODOO-MONTHLY-CLOSING.md`](docs/ODOO-MONTHLY-CLOSING.md)).
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
2. **Task tracker adapter** — Redmine is wired in as the human layer
   (container + MCP bridge). The remaining piece is an orchestrator
   adapter that mirrors tasks ↔ Redmine issues automatically (outbound
   on create/status change, inbound poll for human edits), so the
   mapping convention in `AGENTS.md` becomes enforced rather than
   manual. Jira/GitHub Issues can follow the same adapter shape without
   touching the DSH agents.
3. **Railway deployment** — the compose services map 1:1 to Railway
   services; keep workspace isolation and pinned DSH.
