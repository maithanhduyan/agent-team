# GEPA candidate-PR workflow (T13) — agent-desktop v0.5

> **Task:** TASK-9054 / Redmine #48 — T13: workflow skill evolved →
> branch → PR → human review
> **Author:** backend (backend@agent-team.local)
> **Contract:** `docs/gepa-pipeline.md` §3.3 D6 / §8 (T09, ADR-015/016/017)
> · `docs/skill-evolution-acceptance.md` §6/§7 (T10) ·
> `docs/security-review-memory.md` §5 (SEC-GEPA-01…11)
> **Consumed by:** T15 (reviewer) · T19 (release gate)
> **Inputs:** T12 run record/manifest (`runner/`), T11 dataset
> (`datasets/`), T14 harness (`harness/`)

This directory implements the **PR workflow** of the GEPA pipeline: it
turns a **merge-ready candidate** from a T12 evolution run into a
**dedicated branch + PR into the skill registry**, with the full §6.2
metadata, and enforces the human-review gates. It **never merges** and
**never activates** a candidate (SEC-GEPA-05/06/07).

```
run manifest (T12, SEC-GEPA-11)
  → workflow gate re-check (size ≤ 15 KB · A/B 0 regression ·
    fitness 100% · 0 secrets)        [reject ⇒ NO PR — R-2..R-5, R-9]
  → dedicated branch evolution/<skill>/<run-id>-<candidate>  (BR-1)
  → branch files: SKILL.md + dataset.ref.json + run-audit-record.json (BR-2)
  → PR with full §6.2 metadata        [missing metadata ⇒ CI auto-flag]
  → PR link written back into the run manifest (AT-3)
  → human review: owner + cto approvals (SEC-GEPA-06) — merge manual (SEC-GEPA-07)
  → merge → registry-state regenerated → activation between sessions (SEC-GEPA-05)
```

## Layout

```text
evolution/
├── workflow/                    # T13 — PR workflow (this dir)
│   ├── src/
│   │   ├── cli.ts               # unified CLI (`npm run evolve:pr -- <cmd>`)
│   │   ├── config.ts            # PR_*/EVOLUTION_* env surface
│   │   ├── registry.ts          # BR-1 branch name + BR-2 file set
│   │   ├── size.ts              # SEC-GEPA-03 (≤ 15 KB, wc -c equivalent)
│   │   ├── ab.ts                # SEC-GEPA-04 A/B regression (0 regressions)
│   │   ├── activation.ts        # SEC-GEPA-05 no-hot-swap resolver
│   │   ├── review.ts            # SEC-GEPA-06 approvals + SEC-GEPA-07 scan
│   │   ├── metadata.ts          # T10 §6.2 PR metadata + auto-flag check
│   │   ├── checklist.ts         # SEC-GEPA-01..11 checklist assembly
│   │   ├── github.ts            # GitHub REST (open PR / read reviews) — no merge endpoint
│   │   └── open-pr.ts           # plan + execute (branch → PR → manifest link)
│   └── test/                    # 48 tests (see TESTING.md)
│       └── fixtures/            # merge-ready run manifest + passing candidate
├── runner/                      # T12 evolution runner (consumed by this workflow)
├── harness/                     # T14 eval harness (fitness gate)
├── datasets/                    # T11 datasets (pinned sha256)
└── runs/                        # SEC-GEPA-11 run manifests (gitignored)
```

## How to use

Run from `agent-desktop/` (`npm run evolve:pr -- <command>`):

### Plan a candidate PR (no git, no network)

```bash
npm run evolve:pr -- plan \
  --manifest evolution/runs/evo_20260901_001/manifest.json \
  --candidate gen0-01
```

Prints the branch name, the 3 branch files and the full §6.2 metadata.
The candidate SKILL.md is read from the manifest's `skill_path` (the
T12 runner persists it under `runs/<job_id>/candidates/<candidate_id>/`
— AT-2) or from `--skill <file>`.

### Open the branch + PR (real mode)

```bash
# requires GITHUB_TOKEN + a configured git remote (PR_OWNER/PR_REPO or
# parsed from the remote URL)
npm run evolve:pr -- open-pr \
  --manifest evolution/runs/evo_20260901_001/manifest.json \
  --candidate gen0-01
```

- creates branch `evolution/install-dsh/evo_20260901_001-gen0-01` from
  `develop` in a throwaway worktree, writes **only** the 3 BR-2 files,
  pushes, opens the PR with the §6.2 metadata body, and records the PR
  link back into the run manifest (AT-3);
- `--dry-run` plans only; `--no-push` creates the branch + commit
  locally without pushing;
- **any gate failure rejects before a PR exists** (R-2…R-5, R-9): run
  not `merge-ready`, candidate not `accepted`, size > 15 KB, any A/B
  regression, or a secret-scan hit.

### Checks (CI / human review)

```bash
npm run evolve:pr -- check-metadata <pr-body.md>   # §6.2 auto-flag (BR-3)
npm run evolve:pr -- check-approvals <reviews.json> --owner <login> --cto <login>
npm run evolve:pr -- no-auto-merge [--dir evolution/workflow/src]
npm run evolve:pr -- size <candidate-skill.md>      # SEC-GEPA-03
npm run evolve:pr -- ab <candidate-skill.md>        # SEC-GEPA-04
npm run evolve:pr -- activation <registry-state.json> <skill> <sha256>  # SEC-GEPA-05
npm run evolve:pr -- registry-state <registry-dir> [--manifest <run.json>]
npm run evolve:pr -- link-pr <manifest.json> --branch <b> [--url <u>]
```

- **check-metadata** is the CI auto-flag: a PR body without the full
  §6.2 metadata block (or with a failing gate inside it) exits 1 —
  missing metadata = gate fail (BR-3).
- **check-approvals** verifies the 2-approval rule: **owner AND cto**
  (SEC-GEPA-06). It never merges; it only reports eligibility.
- **no-auto-merge** is the SEC-GEPA-07 structural review: it scans
  workflow/runner sources for merge actions (CLI merge commands,
  PR-merge REST calls, merge flags) and fails if any exist.
- **activation** is the SEC-GEPA-05 runtime check: activation is
  allowed only for a hash present in the **merged registry state**
  (`<registryDir>/registry-state.json`); an unmerged candidate is
  refused (R-6).

## PR metadata (T10 §6.2)

The PR body embeds a machine-readable block delimited by
`GEPA-METADATA-BEGIN`/`GEPA-METADATA-END` plus a human-readable table:

| Field | Source |
|---|---|
| Run id + dataset version + dataset sha256 | run manifest (SEC-GEPA-11) |
| Fitness (SEC-GEPA-02) + size (SEC-GEPA-03) + regression diff vs base (SEC-GEPA-04) | guardrail results (recomputed, CG-1) |
| Guardrail checklist SEC-GEPA-01…11 (pass/fail + evidence ref) | run manifest + recomputed checks |
| Cost report (per-model spend, NO keys — SEC-GEPA-09/SEC-COST-02) | run manifest `judge_cost` |
| Candidate diff vs base skill | git diff (Files tab) + sha256 pair |

## Security mapping (SEC-GEPA-01…11)

| Requirement | Where T13 satisfies it |
|---|---|
| SEC-GEPA-01 isolation | candidates are read from run artifacts / registry only; the workflow never runs candidate code |
| SEC-GEPA-02 suite 100% | PR gate re-checks fitness = 100% (recorded + recomputed) |
| SEC-GEPA-03 size ≤ 15 KB | `size` check (wc -c equivalent, limit fixed 15 360) — reject R-5 |
| SEC-GEPA-04 semantic | `ab` A/B base vs candidate on the SAME suite — 0 regressions, reject R-4 |
| SEC-GEPA-05 no hot-swap | `activation` reads merged registry state ONLY; unmerged ⇒ refuse (R-6) |
| SEC-GEPA-06 human review | `check-approvals`: owner AND cto, < 2 ⇒ refuse merge (R-7) |
| SEC-GEPA-07 auto-merge off | no merge endpoint in the GitHub client; `no-auto-merge` structural scan (R-8) |
| SEC-GEPA-08 no secrets | secret-scan re-check on the candidate before PR (R-9) |
| SEC-GEPA-09 cost cap | cost report per model, no keys; all-capped ⇒ pause is a T12 gate (never unjudged) |
| SEC-GEPA-10 pinning | supply-chain record carried in the checklist from the run manifest |
| SEC-GEPA-11 audit trail | PR links run record; run record links PR (AT-3); candidate text persisted (AT-2) |

## Human review & merge (SEC-GEPA-06/07)

- Merge requires **2 explicit approvals — owner AND cto — recorded on
  the PR** (T10 §7.1 D-7). The workflow **refuses** merge with fewer
  than 2 approvals (R-7).
- There is **no automated merge path anywhere**: the GitHub client in
  this workflow exposes no merge endpoint; the runner never merges; CI
  (when wired — `.github/workflows` is added once the runner token has
  `workflow` scope, same convention as T06/T14) runs the checks but
  never merges. Merging is a **manual human action** (GitHub merge
  button).
- After a human merge, regenerate the merged registry state:
  `npm run evolve:pr -- registry-state agents/skills --manifest <run.json>`
  — only then can the merged skill be activated between sessions
  (SEC-GEPA-05).

## T12 integration note (AT-2)

The T12 runner (this wave) persists each candidate's SKILL.md under
`runs/<job_id>/candidates/<candidate_id>/SKILL.md` and records
`skill_path` in the run manifest (a small T13-driven addition to
`runner/src/run.ts`). This makes the audit record **replayable** (T10
§6.3 AT-2: dataset hash + harness version + candidate text ⇒ re-derive
fitness) and gives this workflow its candidate input. Before that
integration lands, pass the candidate text explicitly with `--skill`.

## Traceability

| Artifact | Reference |
|---|---|
| Task | TASK-9054 / Redmine #48 (T13) |
| Design | `docs/gepa-pipeline.md` §3.3 D6 / §4.1 / §8 (SEC-GEPA-05/06/07) |
| Acceptance | `docs/skill-evolution-acceptance.md` §6 (workflow) + §7 (done/reject) |
| Security | `docs/security-review-memory.md` §5 (SEC-GEPA-01…11) |
| Inputs | T12 run manifest (PR #34) · T11 dataset (PR #32) · T14 harness (PR #31) |
| Decision | `DECISIONS.md` ADR-022 |
