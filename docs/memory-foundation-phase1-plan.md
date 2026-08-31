# Memory Foundation v0.4 — Phase-0 verdict & Phase-1 execution (PM record)

> Status: executed · Author: pm (pm@agent-team.local) · TASK-6609 /
> Redmine #28 · Date: 2026-09-01 · Project: agent-desktop (subproject
> of agent-team) · Version: v0.4 Memory Foundation (due 2026-09-25)

This is the PM execution record for the approved plan (Redmine #22,
decisions Q1–Q7): phase-0 review verdict, the merge order applied, the
`ARCHITECTURE.md` reconciliation with PR #6 (TASK-179), and the
phase-1 issues created (T03–T08). Phase-2 (T09–T15) is intentionally
**not** created yet.

## 1. Phase-0 review verdict — APPROVE ✅ (both)

| Task | Deliverable (PR) | Verdict | Reviewer |
|---|---|---|---|
| T01 [ba] | Spec 4 tầng + data contract + guardrails — `docs/memory-spec.md`, `REQUIREMENTS.md`, `DECISIONS.md` ADR-004…008 (**PR #9**) | **APPROVE** | pm (this task) |
| T02 [cto] | Security review — `docs/security-review-memory.md`, ADR-009/010, `ARCHITECTURE.md` §8 (**PR #10**) | **APPROVE** | pm (this task) |

Evidence reviewed (full docs on `develop`):

- **T01** — `docs/memory-spec.md` (838 dòng): 4 tầng L1–L4 (§3); data
  contract `core.md`/`sessions.jsonl` + provenance bắt buộc (§4–§6);
  contract `search_memory`/`grep_logs`, retrieval score
  α·sim + β·recency + γ·importance (α=0.5/β=0.3/γ=0.2), hot facts 0ms,
  agentic query (§7); consolidation sleep-time + graduation N=3–5 +
  judge gate (§8); multi-model judge panel Q5 (§9); guardrails
  poisoning/conflict/decay (§10); acceptance mapping cho T06/T07 (§13).
  Khớp plan #22 và quyết định Q1–Q7.
- **T02** — `docs/security-review-memory.md` (433 dòng): threat model
  MINJA/MemoryGraft, 6 đường tấn công P1–P6, verdict MITIGATE/ACCEPT
  cho từng hạng mục; SEC-MEM-01/02, SEC-BND-01, SEC-GEPA-01…11,
  SEC-KEY-01…03, SEC-COST-01/02, SEC-LOG-01/02; Q4 boundary
  (ADR-009), Q5 security (ADR-010). cto sign-off cho phép T03–T05.

Không có hạng mục nào REJECTED; các yêu cầu bổ sung (SEC-MEM-*,
SEC-GEPA-*, SEC-KEY-*) đã được ghi thành input bắt buộc cho T03–T05.

## 2. Merge order (applied)

Per the phase-0 note, **PR #9 (T01) merged first, then PR #10 (T02)**
(stacked on #9). After #9 merged, PR #10's diff auto-shrunk to its own
content only (verified: `.gitignore`, `ARCHITECTURE.md`,
`DECISIONS.md` ADR-009/010, `docs/security-review-memory.md`).

| PR | Content | Merge commit (develop) |
|---|---|---|
| #9 | T01: `docs/memory-spec.md`, `REQUIREMENTS.md`, `DECISIONS.md` ADR-004…008 | `cdae54f` |
| #10 | T02: `docs/security-review-memory.md`, ADR-009/010, `ARCHITECTURE.md` §8, `.gitignore` (.dsh/.agent-team) | `df90b8f` |

## 3. ARCHITECTURE.md reconciliation with PR #6 (TASK-179)

- PR #10's `ARCHITECTURE.md` already embeds PR #6's full content
  (lines 1–290 identical) **plus** §8 (agent-desktop memory
  foundation + GEPA boundary). So the canonical `ARCHITECTURE.md` on
  `develop` is the reconciled union — no extra patch needed.
- PR #6 (TASK-179) remains open on GitHub. Its remaining unique
  content is the skeleton `DECISIONS.md` ADR-000…008 set + README
  fixes. **Note for when PR #6 merges:** ADR-004…008 in PR #6 (skeleton
  scope) collides with ADR-004…010 now merged from PR #9/#10 (memory
  scope) — per the ADR-ownership rule in `DECISIONS.md`, the cto
  renumbers/owns ADRs on merge. Tracked; non-blocking for phase 1.

## 4. Phase-1 issues created (T03–T08)

Only after T01/T02 approved. All: project **agent-desktop** (id 3),
version **v0.4 Memory Foundation** (id 6), tracker Task, status **New**,
dependencies recorded as Redmine relations (`precedes`).

| # | Issue | Agent (user id) | Depends on | Status |
|---|---|---|---|---|
| #29 | [backend] T03 — Core memory module (writer sessions.jsonl + core.md + provenance) | backend (7) | T01 (#25) | New |
| #30 | [backend] T04 — Tools search_memory + grep_logs (retrieval α/β/γ, hot facts inject) | backend (7) | #29 | New |
| #31 | [backend] T05 — Consolidation job (reflection + graduation + judge gate) — SEC-MEM/SEC-GEPA-01..11, ADR-009/010 input bắt buộc | backend (7) | #29 | New |
| #32 | [tester] T06 — Test fixtures + suite (poisoning/conflict/decay/stale) | tester (9) | #29, #30, #31 | New |
| #33 | [reviewer] T07 — Review PR v0.4 memory foundation | reviewer (10) | #32 | New |
| #34 | [backend] T08 — Tích hợp bridge Telegram cho memory (chạy sandbox trước) | backend (7) | #29, #30, #31 | New |

Mỗi issue đều ghi: phạm vi (theo #22), phụ thuộc, tiêu chí hoàn
thành (theo spec §13 / SEC-*), traceability (pm đã tạo, gán đúng user
theo email). Prefix `[agent]` ở ĐẦU subject (bài học sync #25/#26) để
orchestrator Redmine-sync import 1:1 thành orchestrator task.

## 5. Phase-2 (T09–T15) — deliberately NOT created

The concurrency lesson (TASK-027 runner crash: 2 agents chạy song
song trên workspace dùng chung làm mất `.agent-team/`) requires
**không để 2 agent chạy code song song trên workspace dùng chung**.
Phase-2 issues will be created only after phase 1 (T03–T08) has
results. Phase-3 (T16–T21) likewise deferred.

## 6. Q5 note

Multi-model judge team (gpt-4/gemini-3) chờ chủ dự án cấp
`OPENAI_API_KEY` + `GEMINI_API_KEY` (SEC-KEY-01…03). Tạm thời pipeline
chạy single-model DeepSeek — không chặn tiến độ; provider abstraction
đã sẵn sàng (spec §9).

---

Trạng thái: phase 0 approved + merged; phase 1 created (#29–#34);
phase 2/3 deferred. (pm@agent-team.local)
