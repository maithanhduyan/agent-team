# TASK-9692 / Redmine #53 — T15: Review pipeline GEPA (PR #34/#35 đã merge)

> **Status:** ✅ REVIEW COMPLETE — **REQUEST CHANGES** (phạm vi hẹp: 2 finding code + 1 observation; phần core review scope đạt về nội dung)
> **Reviewer:** reviewer (reviewer@agent-team.local) · **Date:** 2026-09-01
> **Project:** agent-desktop (subproject của agent-team) · **Version:** v0.5 Skill Evolution (due 2026-10-30)
> **Task:** TASK-9692 / Redmine #53 — T15: Review pipeline GEPA (vòng cuối, giai đoạn 2)
> **Review base:** `develop` @ `c8ffb74` (merge PR #35) · `99194d2` (merge PR #34)
> **Diff reviewed:** PR #34 (T12 — runner + sidecar + fitness gate) + PR #35 (T13 — candidate-PR workflow), merge commits `99194d2` + `c8ffb74`; 108 files, ~13 293 insertions so với `f233b3c`
> **Contracts:** `docs/skill-evolution-acceptance.md` (T10) · `docs/gepa-pipeline.md` (T09) · `docs/security-review-memory.md` §5–§7

> **Ghi rõ phạm vi (theo task):** review này là **review code pipeline GEPA (PR #34/#35 đã merge)** — KHÔNG review skill PR vì chưa có skill evolved nào (chưa chạy pipeline thật); phần review skill PR thuộc vòng sử dụng pipeline thật (sau T17).

---

## 1. Tóm tắt điều hành (TL;DR)

**Verdict: ⛔ REQUEST CHANGES** — nhưng với phạm vi hẹp và rõ ràng, không yêu cầu làm lại pipeline:

1. **Core review scope ĐẠT về nội dung.** Toàn bộ cơ chế theo T10 acceptance đã hiện diện và có test:
   - **SEC-GEPA-04 semantic preservation:** A/B base vs candidate trên cùng dataset pin, candidate pass set ⊇ base pass set, fitness ≥ base, regression diff determinism (CG-1), re-run tại PR time — đúng thiết kế T09 §5.3/§8.
   - **SEC-GEPA-03 size ≤ 15 KB:** cap cố định 15 360, Node re-measure (không tin self-report), config chặn raise cap, workflow re-check.
   - **Fitness gate = GATE, không phải fitness (bài học hermes-agent):** runner **không bao giờ merge**; `merge-ready` chỉ là eligibility; PR + owner/cto approval là T13; **không có auto-merge path nào** (github client không có merge endpoint; `no-auto-merge` scan 0 hits).
   - **SEC-GEPA-05/06/07:** activation chỉ đọc merged registry state (fail-closed); approvals owner + cto; không hot-swap, không auto-merge.
   - **SEC-GEPA-11 audit trail:** manifest chứa dataset hash, verdicts, fitness, guardrail outcomes, verdict; candidate SKILL.md được persist (`skill_path`, AT-2 replay); PR link ghi ngược (AT-3).
   - **Các guardrail còn lại (SEC-GEPA-02, 08, 09, 10):** fitness 1.0 cố định; secret-scan 0 hits (đã tự chạy verify); cost cap all-capped ⇒ pause; supply-chain pin + checkDepsPinned.
2. **2 finding code trong phạm vi PR #34/#35 (cần sửa trước khi coi là hoàn chỉnh):**
   - **F1 (SEC-GEPA-01 / ADR-009 §6.3.2 — mức trung bình):** sidecar spawn kế thừa **toàn bộ env của runner** (`env: { ...process.env, ... }`) — API keys (DEEPSEEK/OPENAI/GEMINI/GITHUB_TOKEN) có trong process env của compute worker, vi phạm "no inherited env secrets" của ADR-009 §6.3.2; đồng thời **không tồn tại probe test egress/escape** dù guardrail evidence khẳng định có ("sandbox probe test asserts egress blocked") — SEC-GEPA-01 "how to verify" (CI probe + sandbox disposable) chưa được implement trong code merged.
   - **F2 (SEC-GEPA-11 — mức thấp):** `schemaCheck = validateManifestSchema(manifest)` ở `run.ts:353` là **dead code**; `manifestValid: true` hardcode (không wire kết quả validation thật vào guardrail) — evidence của audit-trail guardrail overclaim.
3. **1 observation ngoài phạm vi PR #34/#35 (T11 pre-existing, cần follow-up):** fixture `evolution/fixtures/logs/dsh-run.log` được tham chiếu bởi `error-log-cases.jsonl` + test T11 nhưng **chưa từng được commit** (gitignored `*.log`) → `npm run test:evolution` fail 12/27 trên fresh clone. T12/T13 không đụng tới fixtures (git diff rỗng) nên đây là repo-hygiene của T11, không phải regression từ PR #34/#35.

**Lý do không APPROVE ngay:** tiêu chí hoàn thành T15 yêu cầu matrix đầy đủ SEC-GEPA-01..11 với pass/fail + evidence; SEC-GEPA-01 đang **không đạt "how to verify"** trong code merged (không probe test, env inheritance vi phạm capability-drop), và SEC-GEPA-11 có evidence wiring chưa thật. AGENTS.md: *"Reject work that does not meet the acceptance criteria, even if it works"*. REQUEST CHANGES ở đây nhắm vào **2 điểm sửa nhỏ, xác định** (không yêu cầu thiết kế lại).

---

## 2. Phạm vi review & bằng chứng đã thu thập

### 2.1 Diff được review (PR #34 + #35, base `f233b3c`)

| PR | Task / Redmine | Nội dung | Commit head |
|---|---|---|---|
| #34 | T12 / #47 | Evolution runner + fitness gate: `evolution/runner/` (Node/TS), `evolution/sidecar/` (Python GEPA core), `evolution/contracts/` (JSON schemas) | `99194d2` (merge) |
| #35 | T13 / #48 | Candidate-PR workflow: `evolution/workflow/` (branch → PR → metadata → approvals, no auto-merge) | `c8ffb74` (merge) |

Kèm theo (đã merge trước, dùng làm input contract): T09 `docs/gepa-pipeline.md` (#36), T10 `docs/skill-evolution-acceptance.md` (#37), T11 dataset builder (PR #32), T14 harness (PR #31).

### 2.2 Chạy thực tế (reviewer tự chạy, 2026-09-01, trên worktree của `develop` @ `c8ffb74`)

| Kiểm tra | Lệnh | Kết quả |
|---|---|---|
| T12 runner tests | `npm run test:runner` | ✅ **46/46 pass / 0 fail** (kể cả e2e real sidecar + harness gate + mock judge) |
| T12 sidecar tests (Python) | `npm run test:sidecar` | ✅ **27/27 pass / 0 fail** |
| T13 workflow tests | `npm run test:workflow` | ✅ **48/48 pass / 0 fail** (chạy với AGENTS.md như workspace thật) |
| T11 dataset tests | `npm run test:evolution` | ⚠️ **15/27 pass, 12 fail** — fixture `dsh-run.log` thiếu (pre-existing T11, xem §5 O1) |
| Harness selfcheck (T14) | `node --test evolution/harness/tests/harness-selfcheck.test.mjs` | ✅ **9/9 pass** (gate 1.0, mutants detect, determinism) |
| Typecheck evolution | `npm run typecheck:evolution` | ✅ sạch |
| Secret scan dataset | `npm run eval:scan -- evolution/datasets/install-dsh-v0.1.json` | ✅ **0 hits** (17 230 bytes) |
| Secret scan candidate fixture | `secret-scan.ts evolution/workflow/test/fixtures/candidates/gen0-01/SKILL.md` | ✅ **0 hits** (3 802 bytes) |
| Secret scan base skill | `secret-scan.ts evolution/harness/fixtures/install-dsh/SKILL.md` | ✅ **0 hits** (2 728 bytes) |
| CLI checks (T13) | `evolve:pr -- size / ab / no-auto-merge` | ✅ size 3802 ≤ 15360 PASS; A/B fitness 1.0 (12/12) regressions 0 PASS; no-auto-merge 0 hits PASS |

---

## 3. Acceptance-trace matrix — SEC-GEPA-01…11 (T10 §5) + §4 dataset + §7 done/reject

> Ký hiệu: **PASS** = đạt, evidence có trong code merged + test chạy xanh · **FAIL** = không đạt / evidence không có · **(E)** = pass nội dung nhưng evidence/wiring cần bổ sung.

| # | Guardrail (T10 §5) | Verdict | Bằng chứng (file/line + test) |
|---|---|---|---|
| SEC-GEPA-01 | **Environment isolation** — 0 escape/forbidden access; sandbox disposable; CI probe test | ⚠️ **FAIL (E)** | Sidecar spawn `sidecar-client.ts:64-68` dùng `env: { ...process.env, ... }` — **kế thừa toàn bộ env runner** (keys trong process env của compute worker), vi phạm ADR-009 §6.3.2 "no inherited env secrets". `isolationGuardrail` (`guardrails.ts:118-133`) hardcode `actual: 0, pass: true`; evidence khẳng định "sandbox probe test asserts egress blocked" nhưng **không tồn tại probe test nào** trong runner/sidecar/workflow tests (grep egress/escape/EPERM: 0). Không có `.github/workflows` → CI probe chưa wire. Subprocess mode (default) không có container/jail; `EVOLUTION_SANDBOX_IMAGE` chỉ ghi nhãn `mode` trong manifest, không thực sự launch container. → **F1** (§5) |
| SEC-GEPA-02 | **Test suite 100%** — fitness = passed/total, threshold 1.0 | ✅ **PASS** | `harness/lib/fitness.mjs` `gate()` threshold 1.0 hard; `fitness.ts` `evaluateCandidate` consume `gate(result)`; base skill phải PASS 12/12 trước khi run (`run.ts:104-110`); e2e + harness selfcheck xác nhận. Config chặn hạ `EVOLUTION_FITNESS_TARGET` (`config.ts:113-119`). |
| SEC-GEPA-03 | **Size ≤ 15 KB** (15 360 bytes) | ✅ **PASS** | `guardrails.ts:38` `SIZE_LIMIT_BYTES = 15360` fixed; Node re-measure `Buffer.byteLength` (`run.ts:168`); config throw nếu `EVOLUTION_MAX_SKILL_BYTES > 15360` (`config.ts:106-112`); workflow re-check `size.ts`; test size 15361 → fail, 15360 → pass. |
| SEC-GEPA-04 | **Semantic preservation** — 0 regression; candidate pass set ⊇ base pass set; fitness ≥ base trên cùng dataset | ✅ **PASS** | `fitness.ts:67-81` regression diff = base-pass cases candidate fail; `regression.pass = regressions.length === 0`; cùng suite pinned dataset (A/B same run); `workflow/src/ab.ts` re-run deterministic tại PR time (CG-1); test: candidate thiếu EFS guidance → regression detected (`fitness.test.ts:48`); CLI `ab` PASS 0 regressions. |
| SEC-GEPA-05 | **No hot-swap** — activation chỉ giữa sessions, sau merge + approval | ✅ **PASS** | `workflow/src/activation.ts` đọc merged registry state ONLY (`assertRegistryState` fail-closed; `resolveActivation` refuse khi sha256/source không khớp); runner chỉ ghi run artifacts; test activation 110 dòng (`activation.test.ts`). |
| SEC-GEPA-06 | **Human review before merge** — 2 approvals (owner + cto) | ✅ **PASS** | `workflow/src/review.ts` `checkApprovals` roleMap owner+cto, < 2 ⇒ refuse (R-7); `github.ts` chỉ đọc reviews; test `review.test.ts`. PR body nhắc rõ chờ owner + cto approval. |
| SEC-GEPA-07 | **Auto-merge forbidden** — 0 auto-merge events | ✅ **PASS** | `github.ts` **không có merge endpoint** (test structural `! /pulls/\d+/merge/`); `review.ts` `scanForAutoMerge` (8 patterns) scan workflow/src → 0 hits; runner không có code path merge; T13 README "merge is a manual human action". |
| SEC-GEPA-08 | **No secrets** — 0 hits trên dataset + candidate + PR diff | ✅ **PASS** | `src/secret-scan.ts` (6 patterns: env-ref/sk-key/google-key/telegram-token/assignment/pem-key); dataset bị scan 2 lần (T11 build + run-time `run.ts:90-93` throw nếu hit); candidate re-scan tại workflow (`checklist.ts`, `open-pr.ts:150`); **reviewer đã tự chạy: 0 hits** trên dataset, candidate fixture, base skill. |
| SEC-GEPA-09 | **Cost cap** — per-model cap; capped ⇒ auto-disable; all-capped ⇒ pause | ✅ **PASS** | `judge-team.ts:154-198` cap check qua `monthlySpendOf`/`capForProvider`; all-capped ⇒ `gate: 'paused'` (không unjudged write) trừ dry-run test; `run.ts:206-208` runPaused ⇒ verdict `paused`; test judge-team (mock providers, cap reached ⇒ disabled). |
| SEC-GEPA-10 | **Supply-chain pinning** — sidecar deps pinned; no runtime pip install | ✅ **PASS** (E nhỏ) | `sidecar/requirements.txt` pin `dspy==0.1.0` (exact version); `checkDepsPinned` (`guardrails.ts:248-263`) yêu cầu `==`/`;.*==`; runtime stdlib-only (đã verify: chỉ import stdlib); sidecar version ghi manifest. *Lưu ý nhỏ:* `dspy==0.1.0` cần xác nhận là version thật được publish (dspy hiện tại 2.x; README nói hash do CI lockfile sinh) — observation §5 O2. |
| SEC-GEPA-11 | **Audit trail** — dataset hash, verdicts, fitness, guardrail outcomes, verdict; replayable | ⚠️ **PASS (E)** | Manifest schema-validated trong tests; chứa `dataset.sha256`, per-candidate `fitness`/`judge`/`guardrails`/`candidate_verdict`, `judge_cost`, `pr` link (AT-3); candidate SKILL.md persist `skill_path` (AT-2). **Nhưng** `run.ts:353` `schemaCheck` không được dùng (dead code) và `manifestValid: true` hardcode (`run.ts:304`) — guardrail outcome không thực sự derive từ validation. → **F2** (§5) |

### 3.1 Eval dataset (§4 — input T11, cross-check)

| Mục | Verdict | Bằng chứng |
|---|---|---|
| §4.1 SRC-1..3 (provenance) | ✅ PASS (T11) | builder reject source không verify; test SRC-* (riêng fixture `dsh-run.log` thiếu → xem O1) |
| §4.2 FMT-1..5 (format) | ✅ PASS (T11) | schema contract `eval-dataset.schema.json`; dedup; fix ≠ "retry" |
| §4.3 COV-1..3 (coverage) | ✅ PASS (T11) | 24 cases, 4 classes ≥ 3, sha256 pin, immutability guard |
| §4.4 QL-1..3 / SEC-GEPA-08 | ✅ PASS | secret scan 0 hits (đã tự verify) |

### 3.2 §7 done/reject (cross-check trên code runner + workflow)

| Điều kiện | Verdict | Bằng chứng |
|---|---|---|
| D-1 dataset valid | ✅ | `run.ts` stage 1 validate + secret scan; T11 build report |
| D-2 run completed (exit 0, manifest written) | ✅ | `run.ts` try/catch luôn `writeManifest` (kể cả failure — AT-1); e2e assert |
| D-3 fitness = 100% | ✅ | `gate(result)` 1.0; `threshold_met` |
| D-4 no regression (⊇ base) | ✅ | `fitness.regression.pass`; workflow re-check |
| D-5 all guardrails pass | ⚠️ | SEC-GEPA-01 evidence chưa đủ (F1); phần còn lại pass |
| D-6 PR + full §6.2 metadata | ✅ | `metadata.ts` (15 required fields), `check-metadata` auto-flag (BR-3); test |
| D-7 owner AND cto approved | ✅ | `checkApprovals`; runner không merge |
| D-8 merged by human | ✅ | no merge endpoint; manual action |
| D-9 activation between sessions | ✅ | `activation.ts` merged-state only |
| R-2..R-11 reject conditions | ✅ | `planCandidatePr` reject trước PR (R-2..R-5, R-9); `activation` R-6; approvals R-7; auto-merge scan R-8; `paused` R-10; manifest R-11 |

---

## 4. Kết luận chi tiết theo trọng tâm task

### 4.1 Semantic preservation (SEC-GEPA-04) — ĐẠT
Cơ chế A/B đúng thiết kế: base skill chạy qua reference behavior (`harness/impl/reference.mjs`) trên cùng suite; candidate chạy qua `buildBehaviorFromSkillText` (deterministic extraction, CG-1); regression diff = các case base pass mà candidate fail; `pass` = 0 regression; fitness ≥ base là hệ quả của threshold 1.0 (base = 1.0). Workflow re-run A/B tại PR time (`ab.ts`) nên audit replayable. **Không phát hiện lỗi logic.**

### 4.2 Size ≤ 15 KB (SEC-GEPA-03) — ĐẠT
Cap 15 360 cố định ở 2 nơi (runner + workflow share `SIZE_LIMIT_BYTES`); re-measure bằng Node chứ không tin sidecar self-report; config không cho raise; test biên 15360/15361.

### 4.3 Regression check — fitness gate = GATE (bài học hermes-agent) — ĐẠT
Runner ghi `verdict: 'merge-ready'` chỉ khi mọi gate pass + judge approve; **không có hành động merge nào** (SEC-GEPA-06/07). T13 mở PR và chờ 2 approvals; merge là hành động người. Đúng bài học "fitness gate chống regression, không tự quyết merge".

### 4.4 PR + human review workflow (SEC-GEPA-05/06/07) — ĐẠT
Branch dedicated `evolution/<skill>/<run-id>-<candidate>` (BR-1); branch chỉ chứa 3 file (SKILL.md + dataset.ref + run-audit-record, BR-2); PR body có metadata block máy-đọc được + auto-flag `check-metadata` (BR-3); approvals owner+cto; activation fail-closed.

### 4.5 Audit trail (SEC-GEPA-11) — ĐẠT về nội dung, E về wiring (F2)
Manifest đầy đủ và replayable (candidate text persist). Cần wire `schemaCheck` thật vào guardrail outcome (xem F2).

### 4.6 Guardrails còn lại (SEC-GEPA-01, 08, 09, 10) — 08/09/10 ĐẠT; 01 cần sửa (F1)

---

## 5. Findings (specific + actionable)

### F1 — [SEC-GEPA-01 / ADR-009 §6.3.2, mức trung bình] Sidecar kế thừa toàn bộ env runner; probe test không tồn tại
- **File/line:** `evolution/runner/src/sidecar-client.ts:64-68` (`env: { ...process.env, PYTHONPATH: sidecarDir, PYTHONUNBUFFERED: '1' }`); `evolution/runner/src/guardrails.ts:118-133` (isolationGuardrail hardcode pass).
- **Vấn đề 1 — env inheritance:** ADR-009 §6.3.2 yêu cầu *"no inherited env secrets (keys are never exported into the sidecar's environment unless the sandboxed eval truly needs them, and never persisted)"*. Thực tế spawn truyền toàn bộ `process.env` của runner (nơi giữ DEEPSEEK_API_KEY / GITHUB_TOKEN / v.v.) vào process env của Python sidecar (compute worker xử lý dataset + candidate text). Sidecar hiện không đọc env (đã verify stdlib-only, không có `os.environ`), nhưng capability-drop như thiết kế **không được implement** — một sidecar bị lỗi/bị injection có thể đọc secrets từ env.
- **Vấn đề 2 — probe test không tồn tại:** evidence của `isolationGuardrail` khẳng định "sandbox probe test asserts egress blocked" nhưng không có test nào như vậy trong code merged (đã grep toàn bộ runner/sidecar/workflow tests: 0). SEC-GEPA-01 "how to verify" (CI probe egress + EPERM + sandbox disposable) chưa được implement; cũng chưa có `.github/workflows`.
- **Fix đề xuất:**
  1. Whitelist env khi spawn: chỉ truyền `PATH`, `PYTHONPATH`, `PYTHONUNBUFFERED` (và bất kỳ var không-bí-mật cần thiết) thay vì `{ ...process.env }`.
  2. Thêm probe test thật (egress blocked / write real path EPERM / scratch-only) hoặc sửa evidence guardrail để không overclaim, và ghi rõ sandbox là deployment/CI responsibility cho tới khi CI probe được wire.

### F2 — [SEC-GEPA-11, mức thấp] `schemaCheck` dead code; `manifestValid` hardcode
- **File/line:** `evolution/runner/src/run.ts:353` (`const schemaCheck = validateManifestSchema(manifest);` — kết quả không được dùng); `evolution/runner/src/run.ts:304` (`manifestValid: true` hardcode với comment "set below after validation" nhưng không bao giờ wire).
- **Vấn đề:** guardrail SEC-GEPA-11 trong manifest luôn ghi `pass: true` bất kể manifest có schema-valid hay không; evidence "schema-validated against gepa-run-manifest.schema.json" overclaim. Manifest hiện tại valid (e2e test assert), nhưng outcome của guardrail không derive từ validation thật.
- **Fix đề xuất:** dùng kết quả `validateManifestSchema` (hoặc `throw`/fail run nếu invalid) và truyền `manifestValid: schemaCheck.valid` vào `runLevelGuardrails`; tương tự cho per-candidate guardrail (`run.ts:221`).

### O1 — [Ngoài phạm vi PR #34/#35; T11 pre-existing] Fixture `dsh-run.log` thiếu → `test:evolution` fail trên fresh clone
- **Bằng chứng:** `evolution/fixtures/logs/error-log-cases.jsonl` tham chiếu `dsh-run.log:6..11`; test T11 (`build-eval-dataset.test.ts`) require file này; nhưng `dsh-run.log` chưa từng được commit (gitignore `*.log`) — `git log --all -- *dsh-run*` rỗng. T12/T13 không đụng fixtures (git diff rỗng) nên đây **không phải regression từ PR #34/#35**.
- **Tác động:** `npm run test:evolution` fail 12/27 trên fresh clone — ảnh hưởng tới "tests pass" của develop nói chung.
- **Đề xuất:** follow-up T11/backend: force-add fixture (hoặc sinh từ harness) để fresh clone test xanh; không chặn verdict PR #34/#35.

### O2 — [Nhỏ] `dspy==0.1.0` — xác nhận version được publish
- `requirements.txt` pin `dspy==0.1.0`; `checkDepsPinned` pass vì có `==`. dspy hiện tại (Stanford DSPy) là 2.x; nếu `0.1.0` không tồn tại trên PyPI thì CI lockfile (`pip install --require-hashes`) sẽ fail. Runtime stdlib-only nên không ảnh hưởng vận hành; đề xuất pin version thật hoặc ghi rõ placeholder + verify trong CI build.

---

## 6. Verdict

**⛔ REQUEST CHANGES** — phạm vi hẹp, 2 finding code:

1. **F1 (SEC-GEPA-01):** whitelist env khi spawn sidecar (bỏ `...process.env`); thêm probe test egress/escape thật hoặc sửa evidence guardrail cho đúng trạng thái hiện tại.
2. **F2 (SEC-GEPA-11):** wire kết quả `validateManifestSchema` vào `manifestValid` (bỏ dead code / hardcode).

Phần còn lại (SEC-GEPA-02, 03, 04, 05, 06, 07, 08, 09, 10 + §4 dataset + §7 done/reject) **PASS về nội dung** với test xanh và evidence đầy đủ. O1 (fixture T11) và O2 (dspy version) là follow-up ngoài PR #34/#35 / không blocking.

**Không yêu cầu:** thiết kế lại pipeline, thay đổi contract, hay làm lại runner/workflow.

---

## 7. Traceability

| Artifact | Reference |
|---|---|
| Task | TASK-9692 / Redmine #53 — T15 (vòng cuối, giai đoạn 2 — v0.5 Skill Evolution) |
| Review base | `develop` @ `c8ffb74` (PR #35) / `99194d2` (PR #34) |
| Contracts | `docs/skill-evolution-acceptance.md` (T10 §5/§7/§9) · `docs/gepa-pipeline.md` (T09 §3.3/§4/§5/§8) · `docs/security-review-memory.md` §5–§7 |
| Tests chạy | runner 46/46 · sidecar 27/27 · workflow 48/48 · harness 9/9 · typecheck clean · secret-scan 0 hits |
| Reviewer | reviewer (reviewer@agent-team.local) |
