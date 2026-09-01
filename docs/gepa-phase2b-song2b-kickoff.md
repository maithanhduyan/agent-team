# Phase-2 Đợt 2 — SÓNG 2b Kickoff: T12 (GEPA runner) + T13 (workflow skill→PR); T15 để vòng sau

> PM execution record — **pm (pm@agent-team.local)**, TASK-9036 / Redmine #46,
> 2026-09-01. Plan source: Redmine #22 (Q1–Q7, approved). Wave policy:
> ADR-020 (`DECISIONS.md`, Redmine #43) — tạo GEPA tasks theo 2 sóng chống
> early-dispatch. SÓNG 2a record: `docs/gepa-phase2-dot2-kickoff.md`
> (TASK-8837 / Redmine #43, PR #30).

## 1. Điều kiện mở SÓNG 2b — đạt 2/2

| Điều kiện (ADR-020) | Bằng chứng |
|---|---|
| T11 đã có PR — Eval dataset builder + dataset v0.1 | Redmine #44 **Closed**; **PR #32** (open) — `backend/TASK-8866-redmine-44-t11-eval-dataset-` → `develop` |
| T14 đã có PR — harness fitness gate | Redmine #45 **Closed**; **PR #31** (open) — `tester/TASK-8867-redmine-45-t14-harness-windo` → `develop` |

→ Đủ điều kiện mở SÓNG 2b: tạo ngay **2 issue backend** (xử lý tuần tự qua
runner), **KHÔNG tạo T15** trong vòng này (vòng điều phối kế tiếp, sau khi
T12/T13 có PR — bài học T07: reviewer chỉ chạy khi có artifact).

## 2. SÓNG 2b — đã tạo + sync + dispatch (trong vòng này)

| Task | Redmine | Agent (email) | Orchestrator task | Trạng thái sync |
|---|---|---|---|---|
| **T12** — GEPA runner + fitness gate (Python sidecar DSPy+GEPA core evolution; Node/TS tích hợp ADR-009 trust anchor / ADR-010 judge team đa model Q5 — single-model DeepSeek fallback, cost cap; fitness gate dùng harness T14 PR #31 + dataset T11 PR #32; guardrails SEC-GEPA-01..11; input bắt buộc `docs/gepa-pipeline.md` T09 + `docs/skill-evolution-acceptance.md` T10) | **#47** | backend (backend@agent-team.local) | **TASK-9053** (sync-import, redmine_issue_id=47; auto-dispatch — run 64 **running**) | Issue #47 → **In Progress**; task **in_progress**, run 64 **running** |
| **T13** — Workflow skill evolved → branch → PR → human review (cấm auto-merge, cấm hot-swap giữa phiên, semantic preservation, size ≤ 15 KB; mỗi candidate ra branch riêng theo T09/T10) | **#48** | backend (backend@agent-team.local) | **TASK-9054** (sync-import, redmine_issue_id=48; auto-dispatch — run 65 **dispatched/queued**) | Issue #48 → **In Progress**; task **in_progress**, run 65 **queued** (runner backend xử lý tuần tự sau T12) |

- Cả hai gắn version **v0.5 Skill Evolution** (id 7, due 2026-10-30),
  tracker Task, priority High, gán đúng user backend (id 7,
  backend@agent-team.local).
- **Mô tả T12/T13 đã ghi rõ** (yêu cầu của chủ dự án):
  1. **Đọc PR #32 (dataset) và PR #31 (harness) trước khi code** — kèm link
     trực tiếp + contract cốt lõi (schema §4.2, coverage §4.3, hash pinning;
     result schema + `gate(result)` của harness).
  2. **Benchmark/fitness gate là GATE không phải fitness** (bài học
     hermes-agent): fitness chỉ dùng để **chống regression** (so candidate
     vs base trên CÙNG dataset), KHÔNG phải thước đo "hay hơn" để tự quyết
     merge — merge chỉ qua GATE 100% (SEC-GEPA-02) + 0 regression
     (SEC-GEPA-04) + đủ guardrails + judge + human review (SEC-GEPA-06/07).
- **Ghi chú vận hành:** sync của orchestrator (deployed) tự import issue mới
  subject `[<agent>] ...` và **auto-dispatch ngay** (đúng cảnh báo đã ghi ở
  SÓNG 2a, TASK-8837). Task sync-import là bản chính (có `redmine_issue_id`
  47/48); không tạo task tay trùng.

## 3. T15 — KHÔNG tạo trong vòng này (điều kiện đã ghi)

| Task | Agent | Điều kiện tạo (đã ghi để vòng điều phối kế tiếp thực hiện) |
|---|---|---|
| **T15** — Review pipeline GEPA + các PR skill evolved (semantic preservation, size, diff quality, regression) | reviewer | **SAU khi T12 (#47) và T13 (#48) có PR** — bài học T07: reviewer chỉ chạy khi có artifact |

- Điều kiện đã ghi trong: ADR-020 (`DECISIONS.md`), mô tả T12 (#47) / T13
  (#48) mục Phụ thuộc, và issue #46 (note phản hồi của vòng này).

## 4. Ghi chú hồ sơ vận hành

- **PR #30 (TASK-8837 — SÓNG 2a kickoff doc) đang mở**, chưa merge; bản ghi
  vòng này là file độc lập `docs/gepa-phase2b-song2b-kickoff.md` — khi merge
  cả hai, cập nhật chéo liên kết nếu cần (trivial).
- **Q5 — API keys:** vẫn chờ chủ dự án cấp `OPENAI_API_KEY` /
  `GEMINI_API_KEY` cho judge team đa model; KHÔNG chặn — panel mặc định
  `JUDGE_PANEL_MODELS=deepseek`, single-model fallback chạy pipeline
  (SEC-KEY-03 — skip, never fail; SEC-GEPA-09 all-capped ⇒ pause an toàn).

## 5. Traceability

- Orchestrator tasks vòng này: TASK-9053 (T12/backend, redmine_issue_id 47),
  TASK-9054 (T13/backend, redmine_issue_id 48) — sync-import, auto-dispatch,
  run 64 (running) + run 65 (queued).
- Redmine: #47 (T12, In Progress), #48 (T13, In Progress), #46 (vòng này,
  In Progress — note phản hồi ở mục 2 của issue).
- Branch: `pm/TASK-9036-redmine-46-s-ng-2b-t-o-t12-g` (PR mở từ branch này).
