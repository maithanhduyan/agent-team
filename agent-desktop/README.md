# agent-desktop — v0.4 Memory Foundation

`agent-desktop` is a DSH deployment on the owner's Windows laptop with a
Telegram bridge (plan #22 Q1; ARCHITECTURE.md §8). This directory holds
the v0.4 Memory Foundation work: the contract lives in
[`docs/memory-spec.md`](../docs/memory-spec.md) (T01) and
[`docs/security-review-memory.md`](../docs/security-review-memory.md)
(T02); implementation is T03/T04/T05 (Redmine #29/#30/#31) and testing is
T06 (this PR, Redmine #32).

## Tests (T06)

- Fixtures + suite: [`tests/`](tests/) — see [`tests/README.md`](tests/README.md)
- Results report: [`TESTING.md`](TESTING.md)

```bash
node tests/run-suite.mjs   # from this directory
```

## Status (2026-09-01)

- T03/T04/T05 implementation: **not merged yet** (Redmine #29/#30/#31 In
  Progress). The T06 implementation suites skip with that reason; the
  fixture selfcheck is green.
