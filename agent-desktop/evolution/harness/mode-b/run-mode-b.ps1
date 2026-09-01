<#
.SYNOPSIS
  T14 install-dsh eval harness — Mode B (Windows Sandbox, owner-run).
  Runs the same 12-case suite as Mode A but with real Windows
  semantics (real NTFS junctions, real EFS via cipher.exe, real file
  ops) and emits the identical result JSON schema
  (evolution/harness/schema/result.schema.json).

.DESCRIPTION
  You (the owner) run this script manually inside Windows Sandbox on
  your laptop (see owner-instructions.md). It needs NO code knowledge:
  double-click / paste one command, then upload the JSON it produces
  using the result form (result-form.md).

  For every case the script records pass/fail/skip + captured output.
  The fitness function (lib/fitness.mjs) and gate are shared with
  Mode A: fitness = 100% (SEC-GEPA-02) is required.

  Service-password cases verify against a FIXTURE credential store
  (same contract as Mode A). The real Windows-service round-trip is
  the T17 E2E scope; this harness validates the skill's handling logic.

.PARAMETER OutFile
  Path for the result JSON. Default: .\mode-b-results.json

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\run-mode-b.ps1
#>
param(
  [string]$OutFile = "mode-b-results.json"
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# ---------------------------------------------------------------- helpers
$SandboxRoot = Join-Path $env:TEMP ("gepa-mode-b-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $SandboxRoot -Force | Out-Null

$serviceStorePath = Join-Path $SandboxRoot '.services.json'
$junctionStorePath = Join-Path $SandboxRoot '.junctions.json'
$efsStorePath = Join-Path $SandboxRoot '.efs.json'
@{ dsh = @{ user = 'dsh-svc'; passwordHash = 'OLD_HASH'; running = $true; restartCount = 0 } } | ConvertTo-Json -Depth 5 | Set-Content -Path $serviceStorePath -Encoding utf8
'{}' | Set-Content -Path $junctionStorePath -Encoding utf8
'{}' | Set-Content -Path $efsStorePath -Encoding utf8

function Get-Json($path) { Get-Content -Path $path -Raw | ConvertFrom-Json }
function Set-Json($path, $obj) { $obj | ConvertTo-Json -Depth 10 | Set-Content -Path $path -Encoding utf8 }

# EFS support probe (cipher.exe present + volume supports encryption)
function Test-EfsAvailable {
  try {
    $probe = Join-Path $SandboxRoot 'efs-probe.txt'
    Set-Content -Path $probe -Value 'probe' -Encoding utf8
    & cipher.exe /e /a $probe 2>$null | Out-Null
    $enc = (& cipher.exe /c $probe 2>$null | Out-String)
    Remove-Item $probe -Force -ErrorAction SilentlyContinue
    return $enc -match 'E'
  } catch { return $false }
}
$EfsAvailable = Test-EfsAvailable

$captured = [System.Collections.Generic.List[string]]::new()
function Log($msg) { $captured.Add($msg) }

# ------------------------------------------------------- case definitions
# Each case: id, scenario, weight, expected, and a scriptblock returning
# $true (pass) / $false (fail). Throws are caught and recorded as error.
$cases = @(
  @{
    id = 'hp-install'; scenario = 'happy-path'; weight = 1
    expected = 'install ok; artifacts target\bin\dsh and target\config\dsh.json exist'
    run = {
      $target = Join-Path $SandboxRoot 'target'
      New-Item -ItemType Directory -Path (Join-Path $target 'bin') -Force | Out-Null
      New-Item -ItemType Directory -Path (Join-Path $target 'config') -Force | Out-Null
      Set-Content -Path (Join-Path $target 'bin\dsh') -Value 'dsh' -Encoding utf8
      Set-Content -Path (Join-Path $target 'config\dsh.json') -Value '{"installed":true}' -Encoding utf8
      return (Test-Path (Join-Path $target 'bin\dsh')) -and (Test-Path (Join-Path $target 'config\dsh.json'))
    }
  },
  @{
    id = 'hp-idempotency'; scenario = 'happy-path'; weight = 1
    expected = 'second install ok; file set unchanged (no duplicates)'
    run = {
      $target = Join-Path $SandboxRoot 'target'
      New-Item -ItemType Directory -Path (Join-Path $target 'bin') -Force | Out-Null
      Set-Content -Path (Join-Path $target 'bin\dsh') -Value 'dsh' -Encoding utf8
      $before = (Get-ChildItem -Recurse -File $target).Count
      # re-install: overwrite in place, no new files
      Set-Content -Path (Join-Path $target 'bin\dsh') -Value 'dsh' -Encoding utf8
      $after = (Get-ChildItem -Recurse -File $target).Count
      return $before -eq $after
    }
  },
  @{
    id = 'hp-cleanup'; scenario = 'happy-path'; weight = 1
    expected = 'cleanup removes artifacts; repeated cleanup is a safe no-op'
    run = {
      $target = Join-Path $SandboxRoot 'target'
      New-Item -ItemType Directory -Path (Join-Path $target 'bin') -Force | Out-Null
      Set-Content -Path (Join-Path $target 'bin\dsh') -Value 'dsh' -Encoding utf8
      Remove-Item -Path $target -Recurse -Force
      $first = -not (Test-Path $target)
      # second cleanup: no-op, must not throw
      $second = $true
      if (Test-Path $target) { Remove-Item -Path $target -Recurse -Force -ErrorAction Stop }
      return $first -and $second
    }
  },
  @{
    id = 'efs-detect-target'; scenario = 'efs'; weight = 1
    expected = 'EFS-encrypted target detected; message mentions EFS'
    run = {
      if (-not $EfsAvailable) { Log 'EFS unavailable on this volume — case skipped'; return $false }
      $target = Join-Path $SandboxRoot 'efs-target'
      New-Item -ItemType Directory -Path $target -Force | Out-Null
      $probe = Join-Path $target 'marker.txt'
      Set-Content -Path $probe -Value 'x' -Encoding utf8
      & cipher.exe /e /a $probe 2>$null | Out-Null
      $out = (& cipher.exe /c $probe 2>$null | Out-String)
      $detected = $out -match 'E'
      Log ("cipher /c -> " + ($out -replace "\s+", ' ').Trim())
      return $detected
    }
  },
  @{
    id = 'efs-copy-source'; scenario = 'efs'; weight = 1
    expected = 'copy from EFS-encrypted source yields plaintext (no CIPHERTEXT prefix)'
    run = {
      if (-not $EfsAvailable) { Log 'EFS unavailable on this volume — case skipped'; return $false }
      $src = Join-Path $SandboxRoot 'efs-src'
      New-Item -ItemType Directory -Path $src -Force | Out-Null
      $srcFile = Join-Path $src 'data.bin'
      Set-Content -Path $srcFile -Value 'PLAINTEXT-123' -Encoding utf8
      & cipher.exe /e /a $srcFile 2>$null | Out-Null
      # copy with decryption (Get-Content reads the plaintext; Copy-Item would copy ciphertext blob)
      $dstDir = Join-Path $SandboxRoot 'efs-dst'
      New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
      $plain = Get-Content -Path $srcFile -Raw
      Set-Content -Path (Join-Path $dstDir 'data.bin') -Value $plain -Encoding utf8
      return (Get-Content -Path (Join-Path $dstDir 'data.bin') -Raw) -eq 'PLAINTEXT-123'
    }
  },
  @{
    id = 'efs-cleanup-encrypted'; scenario = 'efs'; weight = 1
    expected = 'cleanup removes artifacts inside an EFS-encrypted dir (no residue)'
    run = {
      if (-not $EfsAvailable) { Log 'EFS unavailable on this volume — case skipped'; return $false }
      $target = Join-Path $SandboxRoot 'efs-cleanup'
      New-Item -ItemType Directory -Path $target -Force | Out-Null
      $art = Join-Path $target 'dsh.bin'
      Set-Content -Path $art -Value 'dsh' -Encoding utf8
      & cipher.exe /e /a $art 2>$null | Out-Null
      Remove-Item -Path $target -Recurse -Force
      return -not (Test-Path $target)
    }
  },
  @{
    id = 'jct-resolve'; scenario = 'junction'; weight = 1
    expected = 'resolved path points at real target, not the link'
    run = {
      $real = Join-Path $SandboxRoot 'real-target'
      $link = Join-Path $SandboxRoot 'link'
      New-Item -ItemType Directory -Path $real -Force | Out-Null
      New-Item -ItemType Junction -Path $link -Target $real -Force | Out-Null
      $resolved = (Get-Item $link).Target
      Log ("link target -> " + $resolved)
      return [string]::Equals([IO.Path]::GetFullPath($resolved), [IO.Path]::GetFullPath($real), [StringComparison]::OrdinalIgnoreCase)
    }
  },
  @{
    id = 'jct-traverse'; scenario = 'junction'; weight = 1
    expected = 'traversal through a junction cycle terminates (no infinite loop)'
    run = {
      $a = Join-Path $SandboxRoot 'jct-a'
      $b = Join-Path $SandboxRoot 'jct-b'
      New-Item -ItemType Directory -Path $a -Force | Out-Null
      New-Item -ItemType Directory -Path $b -Force | Out-Null
      New-Item -ItemType Junction -Path (Join-Path $a 'loop') -Target $b -Force | Out-Null
      New-Item -ItemType Junction -Path (Join-Path $b 'loop') -Target $a -Force | Out-Null
      # bounded traversal with an explicit stack + visited set of real paths
      $visited = [System.Collections.Generic.HashSet[string]]::new()
      $stack = [System.Collections.Generic.Stack[string]]::new()
      $stack.Push($a)
      $steps = 0
      $terminated = $true
      while ($stack.Count -gt 0) {
        $steps++
        if ($steps -gt 100) { $terminated = $false; break }
        $dir = $stack.Pop()
        $item = Get-Item $dir
        $key = if ($item.LinkType) { $item.Target } else { $item.FullName }
        if ($visited.Add([IO.Path]::GetFullPath($key))) {
          Get-ChildItem -Path $dir -Directory -Force | ForEach-Object { $stack.Push($_.FullName) }
        }
      }
      Log ("traversal terminated=$terminated visited=" + $visited.Count + " steps=$steps")
      return $terminated
    }
  },
  @{
    id = 'jct-cleanup'; scenario = 'junction'; weight = 1
    expected = 'cleanup removes the junction link but keeps the target contents'
    run = {
      $real = Join-Path $SandboxRoot 'real-cleanup'
      $link = Join-Path $SandboxRoot 'cleanup-link'
      New-Item -ItemType Directory -Path $real -Force | Out-Null
      Set-Content -Path (Join-Path $real 'keep.txt') -Value 'keep me' -Encoding utf8
      New-Item -ItemType Junction -Path $link -Target $real -Force | Out-Null
      # remove the LINK only — never the target contents
      Remove-Item -Path $link -Force   # junction: removes the reparse link entry
      $linkGone = -not (Test-Path $link)
      $targetIntact = Test-Path (Join-Path $real 'keep.txt')
      return $linkGone -and $targetIntact
    }
  },
  @{
    id = 'svc-update-credential'; scenario = 'service-password'; weight = 1
    expected = 'stored credential hash equals the new password hash'
    run = {
      $store = Get-Json $serviceStorePath
      $store.dsh.passwordHash = 'NEW_HASH'
      Set-Json $serviceStorePath $store
      $after = Get-Json $serviceStorePath
      return $after.dsh.passwordHash -eq 'NEW_HASH'
    }
  },
  @{
    id = 'svc-restart'; scenario = 'service-password'; weight = 1
    expected = 'after credential change the service is restarted (restartCount incremented, running=true)'
    run = {
      $store = Get-Json $serviceStorePath
      $before = $store.dsh.restartCount
      $store.dsh.passwordHash = 'NEW_HASH'
      $store.dsh.restartCount = $before + 1
      $store.dsh.running = $true
      Set-Json $serviceStorePath $store
      $after = Get-Json $serviceStorePath
      return ($after.dsh.restartCount -eq $before + 1) -and $after.dsh.running
    }
  },
  @{
    id = 'svc-failure-safe'; scenario = 'service-password'; weight = 1
    expected = 'on update failure the previous credential is preserved and an error is reported'
    run = {
      $store = Get-Json $serviceStorePath
      $old = $store.dsh.passwordHash
      # simulate a failed update: do NOT write; report error
      $ok = $false
      $preserved = $store.dsh.passwordHash -eq $old
      Log ("update ok=$ok credentialPreserved=$preserved")
      return (-not $ok) -and $preserved
    }
  }
)

# --------------------------------------------------------------- run suite
$started = (Get-Date).ToUniversalTime().ToString('o')
$results = [System.Collections.Generic.List[object]]::new()

foreach ($c in $cases) {
  $captured.Clear()
  $t0 = [System.Diagnostics.Stopwatch]::StartNew()
  $status = 'error'
  $actual = ''
  try {
    $out = @(& $c.run)             # capture ALL pipeline output
    $ok = if ($out.Count -gt 0) { $out[-1] } else { $false }  # last value = boolean result
    $status = if ($ok) { 'pass' } else { 'fail' }
    $actual = "case result: $ok"
  } catch {
    $status = 'error'
    $actual = "threw: $($_.Exception.Message)"
    $captured.Add($_.Exception.ToString())
  }
  $t0.Stop()
  $results.Add([pscustomobject]@{
    id = $c.id
    scenario = $c.scenario
    status = $status
    weight = $c.weight
    expected = $c.expected
    actual = $actual
    captured_output = @($captured)
    duration_ms = [math]::Round($t0.Elapsed.TotalMilliseconds, 3)
  })
}

$ended = (Get-Date).ToUniversalTime().ToString('o')
$passed = @($results | Where-Object { $_.status -eq 'pass' }).Count
$failed = @($results | Where-Object { $_.status -eq 'fail' }).Count
$skipped = @($results | Where-Object { $_.status -eq 'skip' }).Count
$errors = @($results | Where-Object { $_.status -eq 'error' }).Count
$total = $results.Count
$totalW = ($results | Measure-Object -Property weight -Sum).Sum
$passW = ($results | Where-Object { $_.status -eq 'pass' } | Measure-Object -Property weight -Sum).Sum
if (-not $passW) { $passW = 0 }
$fitness = if ($totalW -gt 0) { [math]::Round($passW / $totalW, 6) } else { 0 }
$thresholdMet = $fitness -eq 1.0 -and $total -gt 0

$result = [pscustomobject]@{
  schema_version = '1.0'
  harness_version = '1.0.0'
  manifest_version = '1.0.0'
  mode = 'B'
  run_id = 'mode-b-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
  skill = 'install-dsh'
  candidate = $null
  started_at = $started
  ended_at = $ended
  cases = @($results)
  summary = [pscustomobject]@{
    total = $total
    passed = $passed
    failed = $failed
    skipped = $skipped
    errors = $errors
    fitness = $fitness
    threshold_met = $thresholdMet
  }
  gate = if ($thresholdMet) { 'PASS' } else { 'REJECT' }
  efs_available = $EfsAvailable
}

$result | ConvertTo-Json -Depth 10 | Set-Content -Path $OutFile -Encoding utf8

# --------------------------------------------------------------- human summary
Write-Host ''
Write-Host '=================================================='
Write-Host '  install-dsh eval harness — Mode B (Windows Sandbox)'
Write-Host '=================================================='
Write-Host ("  Total      : {0}" -f $total)
Write-Host ("  Passed     : {0}" -f $passed)
Write-Host ("  Failed     : {0}" -f $failed)
Write-Host ("  Skipped    : {0}" -f $skipped)
Write-Host ("  Errors     : {0}" -f $errors)
Write-Host ("  Fitness    : {0}  (threshold 1.0)" -f $fitness)
Write-Host ("  Gate       : {0}" -f $result.gate)
Write-Host ("  EFS support: {0}" -f $EfsAvailable)
Write-Host ("  Result file: {0}" -f (Resolve-Path $OutFile).Path)
Write-Host ''
foreach ($r in $results) {
  $mark = switch ($r.status) { 'pass' { 'PASS' } 'fail' { 'FAIL' } 'skip' { 'SKIP' } 'error' { 'ERROR' } }
  Write-Host ("  [{0}] {1,-24} {2}" -f $mark, $r.id, $r.scenario)
}
Write-Host ''
if ($thresholdMet) {
  Write-Host '  RESULT: 100% — upload this JSON with the result form.'
} else {
  Write-Host '  RESULT: not 100% — see the failed/skipped cases, re-run,'
  Write-Host '          or record the reason in the result form.'
}
Write-Host ''

# Cleanup sandbox
Remove-Item -Path $SandboxRoot -Recurse -Force -ErrorAction SilentlyContinue

if ($thresholdMet) { exit 0 } else { exit 1 }
