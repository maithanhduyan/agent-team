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
| T09 — Thiết kế pipeline GEPA (DSPy + GEPA Python sidecar; Node/TS tích hợp; SEC-GEPA-01..11 + ADR-009/010; fitness gate install-dsh; cost cap; judge team đa model Q5 — fallback DeepSeek) | #36 | cto | TASK-7213 (sync-import) | in_progress |
| T10 — Acceptance criteria cho skill evolution (eval dataset, guardrail định lượng, PR + human review, định nghĩa "done" 1 vòng) | #37 | ba | TASK-7214 (sync-import) | in_progress (lưu ý: sync dispatch ngay — PM rà soát vs T09 khi về) |

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
  TASK-7213 (T09, sync-import), TASK-7214 (T10, sync-import). Các task thủ công
  7208/7215 đã xóa (trùng sync-import).
- Redmine: #33 (T07, reopened + In Progress), #32 (T06, reopened + In
  Progress), #36 (T09, In Progress), #37 (T10, New).

## 6. Bài học vận hành (quan sát thực tế)

- **Orchestrator sync tự import + auto-dispatch issue mới** có subject
  `[<agent>] ...`: tạo issue Redmine mới → sync tạo task + dispatch ngay
  (không đợi dependency). Đúng cảnh báo "sync dispatch mọi issue mới ngay
  lập tức" của chủ dự án ở #35 — gây T10 chạy trước T09, T07 chạy trước
  artifact (đợt trước).
- Khi cần **kiểm soát thứ tự**: tạo issue rồi nhanh chóng điều chỉnh qua
  orchestrator/DB (xóa task thủ công trùng), hoặc tạo issue sau khi
  dependency sẵn sàng. Với T09/T10: task sync-import (7213/7214) là bản
  chính (có redmine_issue_id); task tạo tay (7208/7215) bị xóa.
- Re-dispatch issue CŨ (#32/#33 — đã có task cũ giữ redmine_issue_id) thì
  sync KHÔNG import lại → phải tạo orchestrator task tay (7202/7203).

## 7. Cập nhật kết quả (sau khi các run về)

- **T07 re-dispatch (TASK-7202):** review hoàn tất — **REQUEST CHANGES** phạm
  vi hẹp (lớp tích hợp T06). Implementation PR #14–#17 APPROVE về nội dung
  (15/15 spec §13 + 10/10 guardrails PASS; 197/197 unit test; typecheck +
  secret-scan sạch). Report merged vào develop (PR #20); issue #33 → Feedback.
- **T06 re-run (TASK-7203):** suite chạy **0 skip** trên code đã merge —
  **32 pass / 8 fail** (TESTING.md §5 có root cause + evidence). T05
  consolidation 6/6 green. PR #22 merged (adapters .ts + harness + TESTING.md).
- **8 fail → 4 bug Redmine:** #38 (T03 parseCoreMd skip im lặng) / #39 (T04
  hot-facts decay projection) / #40 (T04 L3 recency anchor — pin spec §7.1)
  → backend TASK-7436/7437/7438; #41 (3 T06-suite self-consistency defects +
  tái sinh golden) → tester TASK-7439 (chờ pin #40). Full suite green sau fix
  wave → T07 chốt APPROVE.
- **Phase-2 đợt 1:** T09 (#36) + T10 (#37) hoàn tất, cả hai **PM APPROVE**,
  PR #19/#21 merged (đã resolve conflict DECISIONS.md/ARCHITECTURE.md —
  renumber T10 ADR-015→ADR-018; restore ADR-015/016/017 bị mất khi merge
  sai → fix commit b6685f4). Điều kiện tạo ĐỢT 2 (T11–T15) đạt 2/2 — tạo ở
  vòng tiếp theo, KHÔNG tạo sớm.

## 8. Kết quả cuối vòng (fix wave #38–#42 hoàn tất)

- **Fix wave merged:** #38 → PR #24 (parseCoreMd FactBlockError), #39 → PR #25
  (hot-facts decay projection, ADR-019), #40 → PR #26 (pin L3 recency
  last_observed, ADR-005 addendum), #41 → PR #27 (3 suite defects + golden
  regen), #42 → PR #28 (searchable-L2 observation-only + provenance_missing).
- **Kiểm chứng cuối (develop @ 9c9fb8b):** T06 full suite **40/40 PASS /
  0 FAIL / 0 SKIP** (T03 6/6 · T04 5/5 · T05 6/6 · fixture selfcheck 17,
  golden 1e-6); unit tests **209/209**; tsc sạch.
- **T07: ✅ FINAL APPROVE** (issue #33 Closed) — v0.4 Memory Foundation
  hoàn tất: 15/15 spec §13 + 10/10 guardrails PASS. Tất cả bug #38–#42 Closed.
- **Phase-2 đợt 1:** T09 (#36) + T10 (#37) APPROVE, PR #19/#21 merged.
  Điều kiện ĐỢT 2 (T11–T15) đạt 2/2 — tạo ở vòng điều phối tiếp theo.
