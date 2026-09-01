# evolution/runs — SEC-GEPA-11 audit-trail manifests

This directory holds the **run manifests** written by the T12 GEPA
evolution runner (one per run: dataset hash, sidecar version, config,
per-generation candidates + guardrail results + verdicts + fitness +
final PR). Manifests are audit evidence (`docs/skill-evolution-acceptance.md`
§6.3) and are **replayable** by T15/T19.

- Files here are generated artifacts — `*.json` in this directory is
  gitignored (`SEC-GEPA-11` records, not source).
- Nothing is committed to this directory by T11 (the dataset builder);
  the builder only writes to `datasets/` and `reports/` (QL-3).
- **Candidate texts (T13 integration, AT-2):** since the runner
  persists each candidate SKILL.md under
  `runs/<job_id>/candidates/<candidate_id>/SKILL.md` and records
  `skill_path` in the manifest, the record carries the candidate text —
  T15/T19 can re-derive fitness from the record alone, and the T13 PR
  workflow consumes the file to build the candidate branch.
