<#
.SYNOPSIS
  Trigger the accountant agent's monthly closing report for a period.

.DESCRIPTION
  Creates a "Kết toán tháng <YYYY-MM>" task on the orchestrator,
  assigned to the accountant agent, and dispatches it. Designed to
  run from Windows Task Scheduler (or manually) on the 1st of each
  month. Idempotent: skips when a task for the same period is
  already queued or in progress; creates a new one after a failure.

.PARAMETER OrchestratorUrl
  Base URL of the orchestrator API (default http://localhost:8000).

.PARAMETER ProjectId
  Id of the project the task belongs to (use this OR ProjectName).

.PARAMETER ProjectName
  Name of the project (resolved to its id via GET /api/projects).

.PARAMETER Month
  Closing period as YYYY-MM (default: previous calendar month).

.PARAMETER SkipDispatch
  Create the task but do not dispatch it (default: dispatch).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\monthly-close.ps1 -ProjectName demo-project

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\monthly-close.ps1 -ProjectId 1 -Month 2025-11
#>
param(
    [string]$OrchestratorUrl = 'http://localhost:8000',
    [int]$ProjectId = 0,
    [string]$ProjectName = '',
    [string]$Month = '',
    [switch]$SkipDispatch
)

$ErrorActionPreference = 'Stop'
$base = $OrchestratorUrl.TrimEnd('/')

if (-not $Month) { $Month = (Get-Date).AddMonths(-1).ToString('yyyy-MM') }
if (-not ($Month -match '^\d{4}-\d{2}$')) { throw "Month must be YYYY-MM, got: $Month" }
if ($ProjectId -le 0 -and -not $ProjectName) { throw 'Provide -ProjectId or -ProjectName' }

$start = "$Month-01"
$end = (Get-Date -Year ([int]$Month.Substring(0, 4)) -Month ([int]$Month.Substring(5, 2)) -Day 1).AddMonths(1).AddDays(-1).ToString('yyyy-MM-dd')

Write-Host "[monthly-close] period: $start .. $end"

# ---------------------------------------------------------- resolve project
$projects = (Invoke-RestMethod -Uri "$base/api/projects" -Method Get).projects
if ($ProjectId -gt 0) {
    $project = $projects | Where-Object { $_.id -eq $ProjectId } | Select-Object -First 1
    if (-not $project) { throw "Project id $ProjectId not found" }
}
else {
    $project = $projects | Where-Object { $_.name -eq $ProjectName } | Select-Object -First 1
    if (-not $project) { throw "Project '$ProjectName' not found (use -ProjectId?)" }
}
Write-Host "[monthly-close] project: $($project.name) (id=$($project.id))"

# -------------------------------------------------------------- dedupe check
$title = "Kết toán tháng $Month"
$existing = (Invoke-RestMethod -Uri "$base/api/tasks?agent=accountant" -Method Get).tasks |
    Where-Object { $_.title -eq $title }
$active = $existing | Where-Object { $_.status -in @('todo', 'in_progress') }
if ($active) {
    $ids = ($active | ForEach-Object { $_.id }) -join ', '
    Write-Host "[monthly-close] task already queued for $Month (ids: $ids) — nothing to do"
    exit 0
}

# -------------------------------------------------------------- create task
$description = @"
Kết toán tháng ${Month}: lập bộ báo cáo kết toán cuối tháng từ dữ liệu Odoo.
Ky ke toan: tu $start den $end.
Theo MONTHLY CLOSING SKILL (.dsh/skills/monthly-closing/SKILL.md) va AGENTS.md:
- Bao cao ket qua kinh doanh (P&L), Bang can doi ke toan (tom tat), To khai GTGT (tom tat)
- Trial balance CSV + AR/AP aging CSV
- Kiem tra checklist ket toan, neu ro bat thuong
QUAN TRONG (SECURITY.md): bao cao chua du lieu kinh doanh bao mat - chi luu trong workspace reports/${Month}/, KHONG commit/push len git, KHONG mo Pull Request.
"@

$body = @{
    project_id     = [int]$project.id
    title          = $title
    description    = $description
    assigned_agent = 'accountant'
    priority       = 'high'
} | ConvertTo-Json

function Show-ApiError {
    param([string]$Message, [string]$ErrorDetails)
    # PS 5.1 Invoke-RestMethod exposes the response body in
    # ErrorDetails.Message (read it in the catch scope — the
    # property does not survive passing the ErrorRecord around).
    $detail = if ($ErrorDetails) { $ErrorDetails } else { $Message }
    Write-Host "[monthly-close] ERROR: $detail" -ForegroundColor Red
    exit 1
}

# PS 5.1 sends the JSON as a string and mis-computes Content-Length
# for non-ASCII (Vietnamese) payloads; send UTF-8 bytes instead.
$bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($body)
try {
    $task = Invoke-RestMethod -Uri "$base/api/tasks" -Method Post `
        -ContentType 'application/json; charset=utf-8' -Body $bodyBytes
    Write-Host "[monthly-close] created task $($task.id): $title (status=$($task.status))"
}
catch {
    Show-ApiError -Message $_.Exception.Message -ErrorDetails $_.ErrorDetails.Message
}

if ($SkipDispatch) {
    Write-Host "[monthly-close] skipped dispatch (-SkipDispatch)"
    exit 0
}

# -------------------------------------------------------------- dispatch
try {
    # Fastify rejects bodyless POSTs without a content-type (415).
    $res = Invoke-RestMethod -Uri "$base/api/tasks/$($task.id)/dispatch" -Method Post `
        -ContentType 'application/json' -Body '{}'
    Write-Host "[monthly-close] dispatched run $($res.run.id) for task $($res.task.id) (agent=$($res.run.agent_id))"
    Write-Host "[monthly-close] done — watch: docker compose logs -f dsh-accountant"
}
catch {
    Show-ApiError -Message $_.Exception.Message -ErrorDetails $_.ErrorDetails.Message
}
