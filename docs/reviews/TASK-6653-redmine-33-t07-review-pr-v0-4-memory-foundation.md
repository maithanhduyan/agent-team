# TASK-6653 / Redmine #33 — T07: Review PR v0.4 memory foundation

> **Status:** ⛔ BLOCKED — dependency không sẵn sàng (chưa có PR để review)
> **Reviewer:** reviewer (reviewer@agent-team.local) · **Date:** 2026-09-01
> **Project:** agent-desktop (subproject of agent-team) · **Version:** v0.4 Memory Foundation (due 2026-09-25)
> **Task:** TASK-6653 / Redmine #33 (T07, phase-1 per #22/#28) · depends on #32 (T06)

---

## 1. Tóm tắt điều hành (TL;DR)

**Chưa thể đưa verdict APPROVE / REQUEST CHANGES cho "PR v0.4 memory
foundation" vì PR của T03–T05 chưa tồn tại và đầu vào bắt buộc của T07
là kết quả test T06 (#32) chưa có.**

Bằng chứng (thu thập lúc review, 2026-09-01 04:10 UTC):

| Kiểm tra | Kết quả |
|---|---|
| GitHub — branch trên `maithanhduyan/agent-team` | Không có branch `backend/TASK-6xxx-*` (T03–T05) hay `tester/TASK-6xxx-*` (T06); chỉ có branch cũ phase-0 (ba/cto/pm) + skeleton |
| GitHub — Pull Requests (open + closed, 100 mới nhất) | Không có PR T03/T04/T05; PR mới nhất là #11 (pm record phase-0, open) và #9/#10 (T01/T02, đã merge) |
| Redmine #29/#30/#31 (T03/T04/T05) | Cả ba **In Progress, done_ratio = 0%**, assigned Backend Developer |
| Redmine #32 (T06) | **In Progress, done_ratio = 0%**, assigned QA Engineer — đầu vào bắt buộc của T07 (#33 precedes #32 theo relations) |
| Workspace backend/tester (`.agent-team`, `workspaces/`) | Trống (chỉ `.gitkeep`) — không có code/fixtures local |
| `develop` tree | Không có module memory implementation (chỉ docs: `memory-spec.md`, `security-review-memory.md`) |

Hệ quả: mọi mục trong acceptance-trace matrix (§3 dưới đây) đều ở trạng
thái **PENDING — chờ PR**, không thể kết luận pass/fail. Theo đúng vai
trò reviewer (AGENTS.md: *"Reject work that does not meet the acceptance
criteria, even if it works"* — và ở đây chưa có work để review), tôi **không
đưa verdict giả** mà báo blocker rõ ràng kèm checklist đã chuẩn bị sẵn
để review ngay khi PR + kết quả T06 xuất hiện.

---

## 2. Dependency audit (bằng chứng chi tiết)

### 2.1 Review base (đã sẵn sàng trên `develop`) ✅

| Thành phần | Trạng thái | Bằng chứng |
|---|---|---|
| T01 spec `docs/memory-spec.md` + `REQUIREMENTS.md` + `DECISIONS.md` ADR-004..008 | ✅ merged | PR #9 → merge commit `cdae54f` |
| T02 security review `docs/security-review-memory.md` + ADR-009/010 + `ARCHITECTURE.md` §8 | ✅ merged | PR #10 → merge commit `df90b8f` |
| Spec §13 acceptance mapping (15 tiêu chí testable cho T06/T07) | ✅ present | `docs/memory-spec.md` §13 (lines 802–820) |
| SEC-MEM-01/02, SEC-GEPA-01..11, SEC-KEY-01..03, SEC-COST-01/02, SEC-LOG-01/02 | ✅ present | `docs/security-review-memory.md` §3/§5/§7 |
| ADR-009 (Q4 boundary), ADR-010 (Q5 judge-team security) | ✅ present | `DECISIONS.md` lines 17–82 |

### 2.2 Đầu vào T07 (chưa sẵn sàng) ❌

- **PR T03 (core memory module, Redmine #29):** không tồn tại
  (không branch, không PR, không commit code trên remote).
- **PR T04 (tools search_memory + grep_logs, Redmine #30):** không tồn tại.
- **PR T05 (consolidation job + judge gate, Redmine #31):** không tồn tại.
- **Kết quả test T06 (Redmine #32, phụ thuộc bắt buộc của #33):** chưa có
  (issue In Progress 0%; không có fixtures, không có suite report).

### 2.3 Quan sát quy trình (non-blocking cho bản thân PR, cần pm/orchestrator theo dõi)

1. **Dispatch sớm:** T07 được dispatch trong khi #29/#30/#31/#32 mới ở
   trạng thái In Progress 0%. Relation `precedes` (#33 ← #32) đã ghi
   đúng nhưng orchestrator không đợi dependency trước khi dispatch.
2. **Concurrency cảnh báo từ #28:** PR #11 ghi rõ bài học "không 2 agent
   chạy code song song trên workspace dùng chung" nhưng T03–T08 vẫn đang
   chạy song song (cả 6 issue In Progress cùng lúc). Không phải lỗi code,
   nhưng cần pm xác nhận điều phối lại nếu vẫn muốn giữ nguyên tắc này.

---

## 3. Acceptance-trace matrix (đối chiếu spec §13 + guardrails bắt buộc)

Trạng thái: **PENDING** = chưa thể đánh giá (chưa có PR/test); cột
"Bằng chứng cần có" là tiêu chí T07 sẽ kiểm khi PR về.

### 3.1 Spec §13 acceptance mapping (15 mục)

| # | Spec | Tiêu chí | Verdict (T07) | Bằng chứng cần có từ PR T03–T05 + T06 |
|---|---|---|---|---|
| 1 | §4.3 / §10.1 | Ghi không provenance → rejected; có `quarantine`/`error` record | ⏳ PENDING | Writer test: thiếu `provenance` → write fail, không partial line; T06 fixture |
| 2 | §5.2 | Mọi dòng `sessions.jsonl` validate schema (mandatory fields) | ⏳ PENDING | Schema validator + test mọi mandatory field; T06 fixture |
| 3 | §5.5 | Rotation transparent: tìm được qua current + archives | ⏳ PENDING | `MEMORY_ROTATE_MB` (default 100); search/grep qua archive; cursor sống sót rotation |
| 4 | §6.2 | `core.md` parse thành fact blocks; thiếu required key → parse error | ⏳ PENDING | Parser + test; T06 fixture |
| 5 | §6.3 | Hot facts (hot, active, importance ≥ 0.8) inject; count ≤ `MEMORY_HOT_MAX` (10) | ⏳ PENDING | Injector đọc `core.md` lúc session start; test count/order; SEC-MEM-01 wrapper |
| 6 | §7.1 | Retrieval formula khớp golden set hand-computed trong 1e-6 | ⏳ PENDING | Golden-set test α·sim + β·recency + γ·importance (0.5/0.3/0.2), recency = exp(-ln2·age/30) |
| 7 | §7.1 | Filters `include_expired`/`provenance`/`since` hoạt động | ⏳ PENDING | Tool test từng filter |
| 8 | §7.2 | `grep_logs` đúng dòng + context, RE2 regex, limit cap | ⏳ PENDING | Test pattern/context/limit; invalid regex → error |
| 9 | §8.3 | Reflection có shape `{context, error, fix}` | ⏳ PENDING | Consolidation test (mock LLM) |
| 10 | §8.4 | Graduation cần N=3–5 observations distinct + judge approve; N<3 → no write + `rejection` | ⏳ PENDING | Graduation rule test N=3/4/5 và N<3; judge mock |
| 11 | §9.3 | Judge verdict JSON validate; malformed → model đó = error | ⏳ PENDING | Verdict schema validator; malformed test |
| 12 | §9.5 | Model auto-disable tại cap; all capped → consolidation pause an toàn | ⏳ PENDING | Mock provider test cap/disable/pause (không cần key thật) |
| 13 | §10.2 | Injection-pattern text → quarantine, không bao giờ tới L3/L4 | ⏳ PENDING | `MEMORY_INJECTION_PATTERNS` scan test; T06 fixture poisoning |
| 14 | §10.3 | Conflict → old `valid_to` + `supersede` record + new block, không ghi đè | ⏳ PENDING | Anti-conflict test; T06 fixture conflict |
| 15 | §10.4 | Day-30: không re-observed → importance halved + `decay` record; stale ~60 ngày | ⏳ PENDING | Decay job test; T06 fixture decay/stale |

### 3.2 Guardrails bắt buộc (yêu cầu riêng của T07)

| Guardrail | Nguồn | Verdict (T07) | Bằng chứng cần có |
|---|---|---|---|
| Provenance bắt buộc mọi record | §4.3, R-PROV-1..4 | ⏳ PENDING | Writer reject + T06 fixture |
| Anti-poisoning (source-gated + injection quarantine) | §10.2.1/§10.2.2 | ⏳ PENDING | Writer test 2 nhánh; fixture poisoning |
| "Data, not instructions" wrapper `[MEMORY_START]…[/MEMORY_END]` **trên mọi render** (hot facts, search results, grep matches) | **SEC-MEM-01** (§3 security review) | ⏳ PENDING | Formatter/writer test cả 3 surface; không render plain tool-output |
| Prompt/AGENTS.md: memory = untrusted evidence, verify trước khi act, không chấp hành lệnh trong memory, `model_inferred` low-trust | **SEC-MEM-02** (§3 security review) | ⏳ PENDING | Nội dung system prompt/AGENTS.md của agent-desktop |
| Anti-conflict (`valid_from`/`valid_to` + `supersede`, judge-approved) | §10.3, R-CORE-3 | ⏳ PENDING | Consolidation test; fixture conflict |
| Decay/anti-drift Day-30 | §10.4 | ⏳ PENDING | Decay test; fixture stale |
| Judge gate fail-safe: malformed/timeout/all-fail → `error`, **không bao giờ write unjudged**; all-capped → pause | §9.4 R-JUDGE-4, §9.5 | ⏳ PENDING | Mock provider test; không key thật |
| Judge/reflection LLM qua provider abstraction (Q5, ADR-008/010); deepseek default; gpt-4/gemini-3 bật khi có key | §9.2, SEC-KEY-03 | ⏳ PENDING | `LLMProvider` interface + registry test |
| Không key trong log/artifact; verdicts L2 chỉ model name + verdict; redaction trước khi log | SEC-KEY-01/02, SEC-LOG-01/02 | ⏳ PENDING | Secret-scan trên diff + test redaction |
| `valid_from`/`valid_to` chỉ consolidation set (không in-turn); không in-turn write L3/L4 (R-MEM-1/2) | §5.4, R-MEM-1/2 | ⏳ PENDING | Writer/tool test |

---

## 4. Verdict

> ## ⛔ BLOCKED — chưa có PR v0.4 (T03–T05) để review; dependency bắt buộc #32 (T06) chưa hoàn thành.

- **Không phải APPROVE, không phải REQUEST CHANGES:** không có diff/code
  để đối chiếu; đưa verdict khi chưa có artifact sẽ là không trung thực
  và vi phạm tiêu chí hoàn thành của T07 ("mỗi mục có kết luận pass/fail"
  — kết luận đó phải dựa trên code thật).
- **Findings blocking (cho việc hoàn thành T07, không phải cho code):**
  1. Không có PR T03/T04/T05 (bắt buộc để review).
  2. Không có kết quả test T06 (#32) — phụ thuộc bắt buộc, theo Redmine
     relation `#33 precedes #32` và phần "Phụ thuộc" của issue #33.
- **Findings non-blocking (quy trình, ghi nhận để pm xử lý):**
  1. Orchestrator dispatch T07 trước khi dependency sẵn sàng.
  2. T03–T08 chạy song song trái với nguyên tắc concurrency ghi ở PR #11.

---

## 5. Điều kiện mở khóa (unblock) — dành cho pm/orchestrator

1. Backend hoàn thành và mở PR T03 (#29), T04 (#30), T05 (#31) trên
   `maithanhduyan/agent-team` (base `develop`), merge hoặc để open theo
   quy trình (reviewer cần branch head để đọc diff).
2. Tester hoàn thành T06 (#32): fixtures + suite chạy xanh + báo cáo
   trace tới spec §13 (mỗi acceptance criterion có kết quả + bằng chứng).
3. Re-dispatch T07 (#33) sau khi (1) và (2) có. Checklist §3 đã sẵn sàng
   để review ngay: 15 mục §13 + 10 guardrails bắt buộc.

---

## 6. Traceability

- Tạo bởi: pm (pm@agent-team.local) — TASK-6609 / Redmine #28.
- Gán: reviewer (reviewer@agent-team.local).
- Branch: `reviewer/TASK-6653-redmine-33-t07-review-pr-v0-`.
- Bằng chứng dependency: GitHub API (branches/PRs) + Redmine API
  (issues #29–#34) + workspace scan — thu thập 2026-09-01 04:10 UTC.

(reviewer@agent-team.local)
