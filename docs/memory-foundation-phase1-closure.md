# Phase-1 Closure — v0.4 Memory Foundation (merge PR #14–#17 + re-dispatch T07) + Phase-2 kickoff

> PM execution record — **pm (pm@agent-team.local)**, TASK-7174 / Redmine #35,
> 2026-09-01. Plan source: Redmine #22 (Q1–Q7, approved). Phase-0 record:
> Redmine #28 (TASK-6609).

## 1. Verdict giai đoạn 1 (T03–T08)

Toàn bộ 5 PR của giai đoạn 1 được PM review và **merge vào develop** theo
thứ tự phụ thuộc. Kiểm chứng PM trước merge (trên cây merge đầy đủ):
- `agent-desktop`: `tsc --noEmit` sạch; **197/197 unit test pass** (T03 50,
  T04 88, T05 161, T08 197 cộng dồn theo từng merge).
- T06 fixtures: **17/20 pass** (fixture selfcheck), 3 implementation suites
  skip có lý do (adapter probe paths cũ — xem §3).
- Scan secret toàn diff: không có key/token thật trong code/artifact
  (chỉ env-var reference + `redactSecrets`).

| PR | Task / Redmine | Nội dung | Merge commit (develop) |
|---|---|---|---|
| #14 | T03 / #29 | Core memory module (L2/L3 writers, provenance, quarantine, rotation) | `1f11417` |
| #15 | T04 / #30 | Tools search_memory + grep_logs (retrieval α/β/γ, hot facts inject) | `0f6db5c` |
| #16 | T05 / #31 | Consolidation job (reflect → graduation → judge gate đa model → verifier) | `8981455` |
| #17 | T08 / #34 | Telegram bridge (sandbox-first, SEC-MEM-01 envelope, SEC-COST-02 spend) | `1cdd5bb` |
| #13 | T06 / #32 | Test fixtures + suite (poisoning/conflict/decay/stale, skip-aware) | `1b42bed` (sau resolve `dc0ef94`) |

Ghi chú stacking: PR #15/#16/#17 dựng stack trên nhau; sau khi merge PR
trước, diff PR sau tự thu gọn (verified — merge sạch, không conflict).
PR #13 (T06) merge song song; conflict duy nhất ở `agent-desktop/README.md`
(add/add) được PM resolve giữ nguyên module doc + bổ sung section Tests
(T06) — commit `dc0ef94` trên branch tester trước khi merge PR #13.

## 2. Re-dispatch T07 (review)

- Lần chạy trước TASK-6653 (run 47) BLOCKED — chưa có artifact T03–T05
  (báo cáo + acceptance-trace matrix sẵn tại `docs/reviews/TASK-6653-…`,
  branch `reviewer/TASK-6653-…`, PR #12).
- Sau merge: **reopen Redmine #33** (T07) + tạo orchestrator task
  **TASK-7202** (reviewer) và **dispatch** — đang chạy. Yêu cầu review đủ
  PR #14–#17 + kết quả suite T06, đối chiếu acceptance-trace matrix (PR #12).

## 3. Tester re-run suite đầy đủ (bỏ skip)

- T06 suite gốc skip 3 implementation suites vì `tests/lib/harness.mjs`
  probe các path `.mjs/.js` trong khi implementation là TypeScript
  (`src/core-writer.ts`, `src/search-memory.ts`, `src/consolidation.ts`).
- **TASK-7203** (tester) đã dispatch: cập nhật adapters (probe `.ts` + map
  exports thực tế từ `src/index.ts` — ASSERTIONS giữ nguyên), chạy
  `node tests/run-suite.mjs` full 20 test, cập nhật `agent-desktop/TESTING.md`
  kết quả thật. Kết quả là đầu vào đối chiếu của T07 (#33).

## 4. Khởi động giai đoạn 2 — v0.5 Skill Evolution (GEPA)

Theo plan #22 (đã duyệt Q1–Q7) — **2 đợt, chống dispatch sớm** (bài học
T07 chạy trước artifact T03–T05):

### Đợt 1 — tạo ngay sau khi giai đoạn 1 xong (đã tạo)

| Task | Redmine | Agent | Orchestrator | Trạng thái |
|---|---|---|---|---|
| T09 — Thiết kế pipeline GEPA (DSPy + GEPA Python sidecar; Node/TS tích hợp; SEC-GEPA-01..11 + ADR-009/010; fitness gate install-dsh; cost cap; judge team đa model Q5 — fallback DeepSeek) | #36 | cto | TASK-7208 | in_progress (đã dispatch) |
| T10 — Acceptance criteria cho skill evolution (eval dataset, guardrail định lượng, PR + human review, định nghĩa "done" 1 vòng) | #37 | ba | TASK-7215 (depends_on 7208) | todo — auto-dispatch khi T09 done |

- Cả hai gắn version **v0.5 Skill Evolution** (id 7, due 2026-10-30),
  tracker Task, relation `precedes` #36 → #37.
- **KHÔNG tạo Đợt 2** (T11–T15) cho tới khi T09/T10 được duyệt trong
  Redmine (quy tắc chống dispatch sớm — LƯU Ý CHÍNH của chủ dự án).

### Đợt 2 — chỉ tạo SAU khi có duyệt T09/T10

| Task | Agent | Nội dung | Depends |
|---|---|---|---|
| T11 | backend | Eval dataset builder (sandbox tests + log lỗi thật → Context/lỗi/cách xử lý đúng) | T09, T10 |
| T12 | backend | GEPA runner + fitness gate (nhiều thế hệ candidate, fitness trên test suite, cost cap, judge đa model Q5) | T09, T11 |
| T13 | backend | Workflow skill evolved → branch → PR → human review (cấm auto-merge) | T12 |
| T14 | tester | Harness eval từ Windows Sandbox tests (install-dsh + planted failures) | T09 |
| T15 | reviewer | Review pipeline GEPA + PR skill evolved (semantic preservation, size ≤15KB, không regression) | T12–T14 |

## 5. Traceability

- Mọi commit merge trên develop giữ author gốc của agent (backend/tester);
  commit resolve conflict `dc0ef94` và các merge commit ký theo quy trình
  (pm TASK-7174).
- Orchestrator tasks: TASK-7202 (T07 re-dispatch), TASK-7203 (T06 rerun),
  TASK-7208 (T09), TASK-7215 (T10).
- Redmine: #33 (T07, reopened + In Progress), #32 (T06, reopened + In
  Progress), #36 (T09, In Progress), #37 (T10, New).
