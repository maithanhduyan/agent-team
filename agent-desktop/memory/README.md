# memory/ — runtime memory data (agent-desktop v0.4)

This directory holds the **runtime memory files** created by the memory
module (T03+). It is not committed; the layout is fixed by
`docs/memory-spec.md` §4.1:

- `sessions.jsonl` — L2 episodic records (append-only JSONL).
- `sessions-YYYYMMDD.jsonl` — rotated archives (one per day).
- `core.md` — L3 curated fact blocks (written only by consolidation,
  R-CORE-1).
- `consolidation-cursor.json` — consolidation cursor (T05, spec §8.1;
  idempotent/resumable runs, survives rotation).
- `costs-YYYYMM.json` — per-model judge spend + caps for the month
  (T05, spec §9.5 / SEC-COST-01; no memory content, no keys).

The memory directory is created on demand by the writers with `0700`
permissions; files are `0600` (spec §11).
