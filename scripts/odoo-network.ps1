<#
.SYNOPSIS
  Attach the odoo-mcp bridge container to the Odoo stack's docker
  network (idempotent). Run after any `docker compose up` that
  recreates the bridge container.

.DESCRIPTION
  When the Odoo instance runs in a separate docker-compose project,
  the bridge container must join that project's network to resolve
  the Odoo service by name. ODOO_URL in .env must then be the
  service URL, e.g. http://<odoo-service>:8069. Manual
  `docker network connect` is lost on container recreation, so
  re-run this after `docker compose up`.

.PARAMETER Network
  Name of the external docker network hosting the Odoo service
  (default: value of $env:ODOO_DOCKER_NETWORK from .env).

.PARAMETER Container
  Bridge container name (default ai-team-odoo-mcp).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\odoo-network.ps1 -Network <odoo-network>
#>
param(
    [string]$Network = '',
    [string]$Container = 'ai-team-odoo-mcp'
)

if (-not $Network) { $Network = $env:ODOO_DOCKER_NETWORK }
if (-not $Network) {
    Write-Host '[odoo-network] set ODOO_DOCKER_NETWORK in .env (or pass -Network)' -ForegroundColor Yellow
    exit 1
}

$inspect = docker inspect $Container --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' 2>$null
if ($inspect -match [regex]::Escape($Network)) {
    Write-Host "[odoo-network] $Container already on '$Network'"
    exit 0
}
docker network connect $Network $Container
if ($LASTEXITCODE -eq 0) {
    Write-Host "[odoo-network] connected $Container -> $Network (set ODOO_URL=http://odoo:8069 in .env)"
    Write-Host "[odoo-network] NOTE: re-run this script after any 'docker compose up -d' that recreates the bridge"
}
else {
    Write-Host "[odoo-network] FAILED — is network '$Network' present? (docker network ls)" -ForegroundColor Red
    exit 1
}
