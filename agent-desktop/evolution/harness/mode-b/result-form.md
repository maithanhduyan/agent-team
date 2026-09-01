# Result form — Mode B (Windows Sandbox) install-dsh eval run (T14)

> Fill this form after running `run-mode-b.ps1` (see `owner-instructions.md`).
> Upload it together with `mode-b-results.json` to the PR / Redmine issue.
> **Do not put API keys, tokens or real passwords anywhere in this form**
> (SEC-GEPA-08).

## 1. Run metadata

| Field | Value |
|---|---|
| Owner name |  |
| Date (UTC) |  |
| Windows edition / build (from `winver`) |  |
| Windows Sandbox | yes / no (if no — where did you run it?) |
| Harness version (from JSON `harness_version`) | 1.0.0 |
| Result JSON run_id (from JSON `run_id`) |  |
| Result JSON filename | mode-b-results.json |

## 2. Result summary (copy from the console / JSON `summary`)

| Metric | Value |
|---|---|
| Total cases |  |
| Passed |  |
| Failed |  |
| Skipped |  |
| Errors |  |
| **Fitness** (threshold 1.0) |  |
| **Gate** (PASS / REJECT) |  |
| EFS available? (console "EFS support") | yes / no |

## 3. Per-case results (copy the console table)

| Case id | Scenario | Status |
|---|---|---|
| hp-install | happy-path |  |
| hp-idempotency | happy-path |  |
| hp-cleanup | happy-path |  |
| efs-detect-target | efs |  |
| efs-copy-source | efs |  |
| efs-cleanup-encrypted | efs |  |
| jct-resolve | junction |  |
| jct-traverse | junction |  |
| jct-cleanup | junction |  |
| svc-update-credential | service-password |  |
| svc-restart | service-password |  |
| svc-failure-safe | service-password |  |

## 4. Notes / deviations

Anything unusual: skipped cases + reason, re-runs, environment quirks,
or evidence that a real Windows service should be tested later (T17).

```

```

## 5. Sign-off

| | |
|---|---|
| I confirm I ran the provided harness as instructed and did not edit the JSON output | ☐ |
| I confirm no real secrets are included in this form or the uploaded JSON | ☐ |
| Owner signature |  |
