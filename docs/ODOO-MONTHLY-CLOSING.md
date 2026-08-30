# Odoo Monthly Closing (Accountant Agent)

The **accountant agent** (`dsh-accountant`) produces the monthly
closing report pack from your Odoo books: P&L (Báo cáo kết quả kinh
doanh), balance sheet summary (Bảng cân đối kế toán), VAT summary
(Tờ khai GTGT), trial balance, and AR/AP aging — validated against a
month-end checklist — delivered in the accountant's workspace. The
pack contains **confidential business data** and is never pushed to
git (see `SECURITY.md`).

## How it fits

```text
host cron / Task Scheduler (mùng 1 hằng tháng)
   │  scripts/monthly-close.ps1|.sh  -> POST /api/tasks + /dispatch
   ▼
orchestrator ──► dsh-accountant (headless DSH, agent id "accountant")
   │                  │  mcp__odoo__* tools (read-only)
   ▼                  ▼
workspaces/accountant/  odoo-mcp bridge (:8000/mcp, internal only)
   │                        │  holds ODOO_URL/DB/USERNAME/PASSWORD
   ▼                        ▼
reports/YYYY-MM/  (workspace only —  Odoo 16+ (XML-RPC / JSON-2)
 never pushed to git)
```

- The bridge is the only component that holds Odoo credentials; the
  agent never sees them. Writes are disabled on the bridge by design.
- Everything follows the existing bridge pattern (redmine-mcp /
  github-mcp): same patch layer, same fail-open behaviour
  (`failOnStartupError: false`), same internal-only network.

## Prerequisites

- Odoo **16+** (Community or Enterprise). Odoo 16-18 use XML-RPC
  (default); Odoo 19+ should use `ODOO_TRANSPORT=json2` + an API key
  (XML-RPC is deprecated there).
- A database user that can read the accounting data. **Recommended:**
  create a dedicated user in Odoo (Settings → Users) with only the
  access needed (Accounting app) — never share the admin password
  with the bridge.
- The Odoo instance must be reachable **from inside the Docker
  network**: a public URL (Odoo Online / Odoo.sh) works as-is; an
  Odoo on your host machine needs `http://host.docker.internal:8069`
  as `ODOO_URL` (Docker Desktop) or the machine's LAN IP.

## Setup

1. Fill the Odoo block in `.env` (copy from `.env.example`):

   ```bash
   ODOO_URL=https://mycompany.odoo.com     # or http://host.docker.internal:8069
   ODOO_DB=mycompany
   ODOO_USERNAME=agent@mycompany.com
   ODOO_PASSWORD=<password or api key>
   ODOO_TRANSPORT=xmlrpc                   # json2 for Odoo 19+
   # ODOO_API_KEY=<odoo api key>           # json2 only
   # ODOO_LOCALE=vi_VN                     # optional context.lang
   ```

2. Start the stack (bridge + agent):

   ```bash
   docker compose --profile agents --profile integrations up -d
   ```

   The `odoo-mcp` image builds from `docker/odoo-mcp/Dockerfile`
   (pinned `ODOO_MCP_VERSION`, default `1.3.0`).

3. Verify the bridge is up:

   ```bash
   docker compose ps odoo-mcp
   docker compose logs odoo-mcp            # no credential values are logged
   ```

   Then check the agent sees the tools (from the agent container):

   ```bash
   docker compose exec dsh-accountant bash -c \
     'cd /workspace/project && dsh --profile headless "Do the mcp__odoo__* tools exist? List them. Do not query Odoo."'
   ```

   The `mcp__odoo__*` tools appear only when the bridge is healthy.
   The connection itself is lazy: it is established on the first tool
   call, so an unreachable Odoo still starts the bridge fine.

## Triggering

### Manual

```bash
# PowerShell (Windows)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/monthly-close.ps1 -ProjectName demo-project
# or via make (auto-selects the shell)
make monthly-close PROJECT=demo-project
# bash / Linux
./scripts/monthly-close.sh --project demo-project
```

The script creates a `Kết toán tháng <YYYY-MM>` task (previous
calendar month by default) assigned to `accountant`, then dispatches
it. It is idempotent: a task already queued/in progress for the same
period is left alone; after a failure a new task is created.

### Windows Task Scheduler (recommended on this host)

```powershell
schtasks /Create /TN "ai-team monthly closing" /SC MONTHLY /D 1 /ST 08:00 ^
  /TR "powershell -NoProfile -ExecutionPolicy Bypass -File <agent-team-path>\scripts\monthly-close.ps1 -ProjectName demo-project" ^
  /RU SYSTEM /RL HIGHEST
schtasks /Run /TN "ai-team monthly closing"   # test immediately
```

### Linux cron

```cron
0 8 1 * * cd /path/to/agent-team && ./scripts/monthly-close.sh --project demo-project >> /var/log/monthly-close.log 2>&1
```

## What the agent produces

`workspaces/accountant/reports/<YYYY-MM>/` — **workspace-local and
confidential; never committed or pushed** (per `SECURITY.md`):

| File | Content |
|---|---|
| `BC-KQKD-<YYYY-MM>.md` | P&L (B02-DN lines), period + YTD |
| `BC-CDK-T-<YYYY-MM>.md` | Balance sheet summary (B01-DN groups), as of month end |
| `TK-GTGT-<YYYY-MM>.md` | VAT summary: đầu ra / đầu vào / phải nộp (nội bộ) |
| `trial-balance-<YYYY-MM>.csv` | Full trial balance (period + YTD) |
| `ar-ap-aging-<YYYY-MM>.csv` | Aged AR/AP from `receivable_payable_aging` |
| `closing-summary-<YYYY-MM>.md` | Key figures, checklist results, anomalies, assumptions |

Plus `MONTHLY-CLOSING-LOG.md` at the workspace root. The report pack
is **draft material for the human accountant** — the official
declarations are still filed by humans.

## Troubleshooting

- **No `mcp__odoo__*` tools in the agent session**: check
  `docker compose ps odoo-mcp` (must be healthy), the bridge logs,
  and that `ODOO_*` values are set in `.env` (restart `odoo-mcp`
  after changing them). If the bridge logs show the DSH client
  getting **HTTP 421**, the FastMCP host allowlist is rejecting the
  client's `Host: odoo-mcp:8000` header — `MCP_ALLOWED_HOSTS` in
  `compose.integrations.yaml` must contain `odoo-mcp:8000` (it does
  by default; keep it if you customize the env).
- **Bridge healthy but calls fail**: check the Odoo URL is reachable
  from the container (`docker compose exec odoo-mcp python -c
  "import urllib.request; urllib.request.urlopen('$ODOO_URL')"`),
  and that the user has read access to the Accounting app. Odoo 19+
  with XML-RPC blocked? Switch to `ODOO_TRANSPORT=json2` +
  `ODOO_API_KEY`.
- **Odoo runs in a separate docker-compose project**: the bridge
  must join that project's network and use the service URL:

  ```bash
  docker network connect <odoo-network> ai-team-odoo-mcp
  # .env: ODOO_URL=http://<odoo-service>:8069
  ```

  The attach is lost when the bridge container is recreated — re-run
  `scripts/odoo-network.ps1` after any `docker compose up -d`.
  ⚠️ A container reaching `host.docker.internal:8069` may hit a
  *different* Odoo than the host's `localhost:8069` (port
  conflict between a `127.0.0.1`-only forwarder and a `0.0.0.0`
  publisher) — always verify the server version via
  `get_odoo_profile`.
- **Odoo 15 compatibility**: `account.move.line` has no `state`
  field (use `parent_state`), `account.account` has no
  `account_type` (use `internal_type`/`internal_group`), and the
  bridge's `receivable_payable_aging` / `accounting_health_summary`
  tools fail on Odoo 15 — the MONTHLY CLOSING SKILL §8 documents
  the exact fallbacks (compute aging/open items from
  `account.move.line` directly).
- **Version pinning**: bump `ODOO_MCP_VERSION` in `.env` and rebuild:
  `docker compose build odoo-mcp`.
- **Agent never picks up the task**: `docker compose logs
  dsh-accountant` — the runner registers on boot; create the task
  only after the agent has registered
  (`docker compose exec orchestrator sh -c "curl -s localhost:8000/api/agents"`).

## Field-proven run

The full loop was executed against a real Odoo **15.0** ledger:
host script → orchestrator → `dsh-accountant` → odoo-mcp bridge →
Odoo → report pack. Result: task done in ~17 min with the 6
deliverables above (P&L B02-DN, balance sheet B01-DN groups, VAT
01/GTGT summary, trial balance CSV, AR/AP aging CSV, closing summary
with checklist). The Odoo 15 incompatibilities (`parent_state`,
`internal_type`, broken aging/health tools) were discovered on that
run and are documented in SKILL §8. **Lesson recorded:** the first
field run pushed the report pack to the repository; per
`SECURITY.md` that is now prohibited — report packs stay in the
workspace, and the orchestrator gives the accountant no-push
instructions.

## Security notes

- Odoo credentials live only in `.env` and the `odoo-mcp` container
  environment — never in the DB, logs, or agent workspaces.
- The bridge is not published to the host (no `ports:` mapping) and
  never enables writes (`ODOO_MCP_ENABLE_WRITES` is not set).
- Use a dedicated low-privilege Odoo user, not the admin account.
