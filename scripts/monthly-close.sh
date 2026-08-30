#!/usr/bin/env bash
# ==========================================================
# Trigger the accountant agent's monthly closing report.
#
# Creates a "Kết toán tháng <YYYY-MM>" task on the orchestrator
# (assigned to the accountant agent) and dispatches it. Designed
# for cron on the 1st of each month; idempotent — skips when a
# task for the same period is already queued/in progress.
#
# Usage:
#   ./scripts/monthly-close.sh [--project demo-project] [--month 2025-11] [--url http://localhost:8000] [--no-dispatch]
# ==========================================================
set -euo pipefail

ORCHESTRATOR_URL="${ORCHESTRATOR_URL:-http://localhost:8000}"
PROJECT_NAME=""
PROJECT_ID=""
MONTH=""
DISPATCH=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT_NAME="$2"; shift 2 ;;
    --project-id) PROJECT_ID="$2"; shift 2 ;;
    --month) MONTH="$2"; shift 2 ;;
    --url) ORCHESTRATOR_URL="${2%/}"; shift 2 ;;
    --no-dispatch) DISPATCH=0; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$MONTH" ]]; then
  MONTH="$(date -d "$(date +%Y-%m-01) -1 month" +%Y-%m 2>/dev/null || date -v-1m +%Y-%m)"
fi
[[ "$MONTH" =~ ^[0-9]{4}-[0-9]{2}$ ]] || { echo "Month must be YYYY-MM: $MONTH" >&2; exit 2; }
[[ -n "$PROJECT_NAME" || -n "$PROJECT_ID" ]] || { echo "Provide --project or --project-id" >&2; exit 2; }

START="$MONTH-01"
# last day of the month (GNU date), fallback: first of next month minus 1 day
if END="$(date -d "$(date -d "$START" +%Y-%m-01) +1 month -1 day" +%Y-%m-%d 2>/dev/null)"; then
  :
else
  END="$(date -v1d -v+1m -v-1d -j -f %Y-%m-%d "$START" +%Y-%m-%d 2>/dev/null)"
fi
echo "[monthly-close] period: $START .. $END"

# ---------------------------------------------------------- resolve project
PROJECTS_JSON="$(curl -sf "$ORCHESTRATOR_URL/api/projects")"
if [[ -n "$PROJECT_ID" ]]; then
  PROJECT_ID="$(printf '%s' "$PROJECTS_JSON" | grep -o "\"id\":$PROJECT_ID," | head -1 | cut -d: -f2 | tr -d ',')"
  [[ -n "$PROJECT_ID" ]] || { echo "Project id $PROJECT_ID not found" >&2; exit 1; }
else
  # find the first project whose name matches exactly
  MATCHED=$(printf '%s' "$PROJECTS_JSON" | grep -n "\"name\":\"$PROJECT_NAME\"" | head -1 | cut -d: -f1)
  [[ -n "$MATCHED" ]] || { echo "Project '$PROJECT_NAME' not found" >&2; exit 1; }
  PROJECT_ID="$(printf '%s' "$PROJECTS_JSON" | sed -n "${MATCHED}p" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)"
fi
echo "[monthly-close] project id=$PROJECT_ID"

# -------------------------------------------------------------- dedupe check
TITLE="Kết toán tháng $MONTH"
EXISTING="$(curl -sf "$ORCHESTRATOR_URL/api/tasks?agent=accountant")"
if printf '%s' "$EXISTING" | grep -q "\"title\":\"$TITLE\""; then
  ACTIVE_IDS="$(printf '%s' "$EXISTING" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(' '.join(str(t['id']) for t in d['tasks'] if t['title']=='$TITLE' and t['status'] in ('todo','in_progress')))" 2>/dev/null \
    || printf '%s' "$EXISTING" | grep -B2 "\"title\":\"$TITLE\"" | grep -o '"status":"\(todo\|in_progress\)"' | head -1)"
  if [[ -n "$ACTIVE_IDS" ]]; then
    echo "[monthly-close] task already queued for $MONTH (ids: $ACTIVE_IDS) — nothing to do"
    exit 0
  fi
fi

# -------------------------------------------------------------- create task
DESCRIPTION="Kết toán tháng $MONTH: lập bộ báo cáo kết toán cuối tháng từ dữ liệu Odoo.
Ky ke toan: tu $START den $END.
Theo MONTHLY CLOSING SKILL (.dsh/skills/monthly-closing/SKILL.md) va AGENTS.md:
- Bao cao ket qua kinh doanh (P&L), Bang can doi ke toan (tom tat), To khai GTGT (tom tat)
- Trial balance CSV + AR/AP aging CSV
- Kiem tra checklist ket toan, neu ro bat thuong
QUAN TRONG (SECURITY.md): bao cao chua du lieu kinh doanh bao mat - chi luu trong workspace reports/$MONTH/, KHONG commit/push len git, KHONG mo Pull Request."

BODY="$(printf '{"project_id":%s,"title":"%s","description":"%s","assigned_agent":"accountant","priority":"high"}' \
  "$PROJECT_ID" "$TITLE" "$DESCRIPTION")"

TASK="$(curl -sf -X POST "$ORCHESTRATOR_URL/api/tasks" \
  -H 'content-type: application/json' -d "$BODY")"
TASK_ID="$(printf '%s' "$TASK" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)"
echo "[monthly-close] created task $TASK_ID: $TITLE"

if [[ "$DISPATCH" -eq 0 ]]; then
  echo "[monthly-close] skipped dispatch (--no-dispatch)"
  exit 0
fi

# -------------------------------------------------------------- dispatch
# Fastify rejects bodyless POSTs without a content-type (415).
RUN="$(curl -sf -X POST -H 'content-type: application/json' -d '{}' "$ORCHESTRATOR_URL/api/tasks/$TASK_ID/dispatch")"
echo "[monthly-close] dispatched — watch: docker compose logs -f dsh-accountant"
