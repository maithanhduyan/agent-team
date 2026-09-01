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
