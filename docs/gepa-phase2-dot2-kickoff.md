# Phase-2 Đợt 2 Kickoff — v0.5 Skill Evolution: SÓNG 2a (T11, T14) + chốt T07

> PM execution record — **pm (pm@agent-team.local)**, TASK-8837 / Redmine #43,
> 2026-09-01. Plan source: Redmine #22 (Q1–Q7, approved). Phase-1 closure:
> `docs/memory-foundation-phase1-closure.md` (TASK-7174 / Redmine #35).
> Phase-2 đợt 1: T09 (#36) + T10 (#37) — PM APPROVE, PR #19/#21 merged.

## 1. Điều kiện mở ĐỢT 2 — đạt 2/2

| Điều kiện | Bằng chứng |
|---|---|
| T09 [cto] thiết kế pipeline GEPA — duyệt + merge | Redmine #36 Closed; `docs/gepa-pipeline.md` merged qua PR #19 |
| T10 [ba] acceptance criteria skill evolution — duyệt + merge | Redmine #37 Closed; `docs/skill-evolution-acceptance.md` merged qua PR #21 |

Cả hai đều có chữ ký **PM APPROVE** (TASK-7174) và đã nằm trên `develop`
(merge commits từ PR #19/#21). → Đủ điều kiện mở ĐỢT 2, tạo **THEO 2 SÓNG**
(bài học chống dispatch sớm từ #35: sync-dispatch issue mới ngay lập tức
khiến T07 chạy trước artifact T03–T05).

## 2. SÓNG 2a — đã tạo + sync + dispatch (trong vòng này)

| Task | Redmine | Agent (email) | Orchestrator task | Trạng thái sync |
|---|---|---|---|---|
| **T11** — Eval dataset builder (sandbox tests + log lỗi thật → dataset "Context → lỗi → cách xử lý đúng"; input SEC-GEPA-01..11) | **#44** | backend (backend@agent-team.local) | **TASK-8866** (sync-import, redmine_issue_id=44) | Issue #44 → **In Progress**; task **in_progress**, run 61 **running** |
| **T14** — Harness Windows Sandbox (suite install-dsh + planted failures EFS/junction/service-password → fitness gate; Mode A offline + Mode B owner chạy thủ công) | **#45** | tester (tester@agent-team.local) | **TASK-8867** (sync-import, redmine_issue_id=45) | Issue #45 → **In Progress**; task **in_progress**, run 62 **running** |

- Cả hai gắn version **v0.5 Skill Evolution** (id 7, due 2026-10-30),
  tracker Task, priority High.
- **Ghi chú vận hành:** orchestrator sync tự import issue mới có subject
  `[<agent>] ...` và **auto-dispatch ngay** (đúng cảnh báo của chủ dự án ở
  #35). Task thủ công tạo tay trước sync (TASK-8862/8863) đã **xóa qua DB**
  (trùng sync-import) — bản chính là task sync-import có `redmine_issue_id`.
- Lưu ý T11: nếu T14 chưa kịp có manifest scenario classes thì T11 làm
  việc với fixtures/suite có sẵn, ghi rõ giả định và phối hợp với tester
  (đã ghi trong issue #44).

## 3. CHỐT T07 — fix wave #38–#42 xong, suite T06 xanh, #33 đã đóng

### 3.1 Fix wave #38–#42 (đã xong, PR merged)

| Bug Redmine | Task | PR merged | Trạng thái |
|---|---|---|---|
| #38 parseCoreMd FactBlockError | TASK-7436 (backend) | PR #24 | run succeeded → issue Closed |
| #39 hot-facts decay projection | TASK-7437 (backend) | PR #25 | run succeeded → issue Closed |
| #40 L3 recency anchor pin (last_observed) | TASK-7438 (backend) | PR #26 | run succeeded → issue Closed |
| #41 3 T06-suite defects + golden regen | TASK-7439 (tester) | PR #27 | run succeeded → issue Closed |
| #42 searchable-L2 observation-only + provenance_missing | TASK-7805 (backend) | PR #28 | run succeeded → issue Closed |

Tất cả 5 bug đều **Closed** trên Redmine; 5 orchestrator run **succeeded**.

### 3.2 Xác minh suite T06 xanh trên develop

- **Xác minh trực tiếp (PM, 2026-09-01, branch = develop @ f233b3c):**
  `cd agent-desktop && node tests/run-suite.mjs` →
  **40/40 pass / 0 fail / 0 skip** (T03 9/9 · T04 5/5 · T05 6/6 ·
  fixture selfcheck 17/17). Đã cài dev-deps (`npm ci`) để suite chạy đủ
  (không skip implementation suites).
- `agent-desktop/TESTING.md` **đã cập nhật**: §0 Addendum ghi kết quả
  **40/40** sau fix #42 (TASK-7805).

### 3.3 Verdict T07 trên #33

- Reviewer **TASK-7202** (run 50) đã **APPROVE nội dung** implementation
  PR #14–#17 (15/15 spec §13 + 10/10 guardrails PASS; 197/197 unit test;
  typecheck + secret-scan sạch) — xem journal #33 (note 151).
- Sau fix wave + full suite xanh, PM (TASK-7174) đã **ghi verdict cuối cùng
  lên #33: ✅ FINAL APPROVE** (note 164) và **đóng #33** (note 165,
  closed_on 2026-09-01T00:00:00) — v0.4 Memory Foundation hoàn tất.
- **Vòng này:** PM xác minh lại suite xanh (mục 3.2) — verdict FINAL
  APPROVE trên #33 **giữ nguyên**, không cần re-dispatch reviewer
  (reviewer đã APPROVE nội dung từ TASK-7202, điều kiện đóng #33 đạt).

## 4. SÓNG 2b — điều kiện tạo (KHÔNG tạo trong vòng này)

Theo đúng bài học chống dispatch sớm: **KHÔNG tạo T12/T13/T15 bây giờ**.

| Task | Agent | Điều kiện tạo (ghi để vòng điều phối kế tiếp thực hiện) |
|---|---|---|
| **T12** — GEPA runner + fitness gate (Python sidecar DSPy+GEPA, Node/TS tích hợp — ADR-009/010; cost cap; judge team đa model Q5 fallback DeepSeek) | backend | **SAU khi T11 có PR** (trong vòng điều phối kế tiếp) |
| **T13** — Workflow skill evolved → branch → PR → human review (cấm auto-merge) | backend | **SAU khi T11 có PR** (trong vòng điều phối kế tiếp) |
| **T15** — Review pipeline + skill PRs | reviewer | **SAU khi T12/T13 có artifact** (PR) |

- Điều kiện ghi rõ: **SÓNG 2b được tạo SAU khi T11 có PR** — không tạo
  sớm, không sync-dispatch vội (bài học #35).
- T15 thêm điều kiện phụ: chỉ tạo sau khi T12/T13 có artifact (PR).

## 5. Ghi chú hồ sơ vận hành

- **Task #6061 (T02 lần 1, mồ côi vì crash run-40):** giữ nguyên như
  bằng chứng vận hành — **KHÔNG xử lý, KHÔNG tạo task khác** cho nó.
  (Bản chính T02 là TASK-6539 retry / Redmine #27 — đã done; #6061 chỉ
  là dấu vết crash.)
- **Q5 — API keys:** vẫn **chờ chủ dự án cấp** `OPENAI_API_KEY` /
  `GEMINI_API_KEY` cho judge team đa model (gpt-4, gemini-3). **KHÔNG
  chặn**: panel mặc định chỉ bật DeepSeek (`JUDGE_PANEL_MODELS=deepseek`),
  single-model fallback vẫn chạy pipeline (SEC-KEY-03 — skip, never fail).

## 6. Traceability

- Orchestrator tasks vòng này: TASK-8866 (T11/backend), TASK-8867
  (T14/tester) — sync-import, redmine_issue_id 44/45, đã dispatch.
- Redmine: #44 (T11, In Progress), #45 (T14, In Progress), #33 (T07,
  Closed — FINAL APPROVE), #43 (vòng này, In Progress).
- Task thủ công trùng sync (TASK-8862/8863) đã xóa khỏi orchestrator DB.
