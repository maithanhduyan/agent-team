# TASK-6653 / Redmine #33 — T07: Review PR v0.4 memory foundation

> **Status:** ✅ RE-DISPATCH REVIEW COMPLETE — **REQUEST CHANGES** (implementation APPROVED in substance; T06 integration evidence incomplete)
> **Reviewer:** reviewer (reviewer@agent-team.local) · **Date:** 2026-09-01
> **Project:** agent-desktop (subproject of agent-team) · **Version:** v0.4 Memory Foundation (due 2026-09-25)
> **Task:** TASK-7202 / Redmine #33 (T07, re-dispatch) · supersedes the BLOCKED status report in PR #12 (TASK-6653)
> **Review base:** `develop` @ `df90b8f` (post T01 PR #9 + T02 PR #10) → merged PRs #14 (T03) / #15 (T04) / #16 (T05) / #17 (T08) @ `1cdd5bb`; PR #13 (T06 fixtures) merged @ `1b42bed`
> **Diff reviewed:** 64 files, ~12,535 insertions (PRs #14–#17, base develop)

---

## 1. Tóm tắt điều hành (TL;DR)

**Verdict: ⛔ REQUEST CHANGES** — nhưng với phạm vi hẹp và rõ ràng:

1. **Phần implementation memory (PR #14 T03 + PR #15 T04 + PR #16 T05 + PR #17 T08) được review trực tiếp trên code: ĐẠT về mặt nội dung** — bám spec §4–§11, đủ guardrails bảo mật, **197/197 unit test của chính implementation chạy xanh** (kèm `npm run typecheck` sạch), không có lỗi code blocking. Toàn bộ diff đã được secret-scan (chỉ có key giả trong test fixture, không có credential thật).
2. **Phần evidence T06 (bắt buộc theo yêu cầu T07 — "Đối chiếu kết quả suite T06"): CHƯA ĐẠT.** Fixture pack + selfcheck (17/20) xanh, nhưng **3 suite implementation (10-writer / 20-search / 30-consolidation) vẫn SKIP dù code T03–T05 đã merge**, và probe trực tiếp implementation lên oracle T06 cho thấy **5 mismatch cụ thể sẽ làm suite FAIL ngay khi adapter được nối** (chi tiết §5). Tester đang cập nhật adapters (theo dispatch), nhưng các mismatch này cần được xử lý có chủ đích — không phải chỉ sửa đường dẫn probe.
3. Kết luận matrix: **15/15 mục spec §13 và 10/10 guardrails: PASS ở mức implementation (code review + unit test của implementation + fixture T06 certified)**; riêng **3 mục có evidence T06-level FAIL** (row 5 hot-facts, row 6 golden 1e-6, row 7 filters) và 1 mục render SEC-MEM-01 lệch format pin (không đổi verdict nội dung, chỉ cần tái lập oracle).

**Lý do không APPROVE ngay:** tiêu chí hoàn thành T07 yêu cầu "mỗi mục có kết luận pass/fail dựa trên code thật + đối chiếu suite T06". Suite T06 hiện chưa chạy được trên code đã merge; đưa APPROVE khi evidence bắt buộc còn đứt gãy là không trung thực (AGENTS.md: *"Reject work that does not meet the acceptance criteria, even if it works"*). REQUEST CHANGES ở đây nhắm vào **lớp tích hợp T06** (thuộc deliverable v0.4 trên develop), không yêu cầu làm lại memory engine.

---

## 2. Phạm vi review & bằng chứng đã thu thập

### 2.1 Diff được review (PRs #14–#17, base `develop`)

| PR | Task / Redmine | Nội dung | Commit head |
|---|---|---|---|
| #14 | T03 / #29 | Core memory module: `sessions-writer.ts`, `core-writer.ts`, `schema.ts`, `types.ts`, `injection.ts`, `render.ts`, `config.ts` + tests | `a113ec2` (merge `1f11417`) |
| #15 | T04 / #30 | Tools `search_memory` + `grep_logs`, `retrieval.ts`, `hot-facts.ts`, `prompt.ts` (SEC-MEM-02), `tool-budget.ts` + tests | `7a6471c` (merge `0f6db5c`) |
| #16 | T05 / #31 | Consolidation job, judge gate, `llm-provider.ts`, `costs.ts`, `redact.ts`, `reflect.ts`, `verifier.ts`, CLI + tests | `c0b6566` (merge `8981455`) |
| #17 | T08 / #34 | Telegram bridge (`src/telegram/*`, `cli-bridge.ts`), `docs/TELEGRAM-BRIDGE.md` + tests | `65703f7` (merge `1cdd5bb`) |

Kèm theo: PR #13 (T06 fixtures + suite, merge `1b42bed`) — dùng làm đối chiếu evidence.

### 2.2 Chạy thực tế (reviewer tự chạy, 2026-09-01)

| Kiểm tra | Lệnh | Kết quả |
|---|---|---|
| T06 fixture selfcheck | `cd agent-desktop && node tests/run-suite.mjs` | ✅ **17 pass / 3 skip (impl suites) / 0 fail** |
| Typecheck implementation | `npm run typecheck` | ✅ sạch |
| Unit tests implementation (T03–T05–T08) | `npm test` | ✅ **197/197 pass / 0 fail** |
| Secret scan toàn diff | grep key-shapes trên `git diff df90b8f..1cdd5bb` + working tree | ✅ không có credential thật (chỉ key giả trong test) |
| Probe implementation vs oracle T06 | script tạm (đã xoá) | ⚠️ 5 mismatch, chi tiết §5 |

---

## 3. Acceptance-trace matrix — spec §13 (15 mục)

> Cột *Verdict*: **PASS** = đạt ở mức implementation (code review + unit test implementation + fixture T06 certified). Ký hiệu **(E)** = evidence T06-level hiện FAIL — cần tester tái lập oracle (xem §5).

| # | Spec | Tiêu chí | Verdict | Bằng chứng |
|---|---|---|---|---|
| 1 | §4.3 / §10.1 | Ghi không provenance → rejected; có `error`/`quarantine` record | ✅ **PASS** | `sessions-writer.ts append()`: validate `provenance` (R-PROV-1) → `{status:'rejected'}` + `error` audit record, không partial line (§5.1 truncate). Tests: `sessions-writer.test.ts`, `schema.test.ts`; T06 fixture `att-1` certified. |
| 2 | §5.2 | Mọi dòng `sessions.jsonl` validate schema (mandatory fields) | ✅ **PASS** | `schema.ts validateL2Record`: id/ts/type/provenance/source/importance/valid_from bắt buộc; content required-keys per type (§5.3); `readAll()` skip dòng hỏng (§11). Tests: `schema.test.ts` (11). |
| 3 | §5.5 | Rotation transparent: search/grep qua current + archives; cursor sống sót | ✅ **PASS** | `maybeRotate()/rotate()` (rename → `sessions-YYYYMMDD.jsonl`), `readAll()` đọc archives + current; `search_memory` test rotation-transparent; cursor file `consolidation-cursor.json` độc lập với file data (test `recordsSince`). |
| 4 | §6.2 | `core.md` parse thành fact blocks; thiếu required key → parse error | ✅ **PASS** | `parseCoreMd()` + `validateFactBlockMetadata()` → throw `FactBlockError` khi thiếu key; `core-writer.test.ts`; T06 `core-broken.md` certified. |
| 5 | §6.3 | Hot facts (hot, active, importance ≥ 0.8) inject; count ≤ `MEMORY_HOT_MAX` | ✅ **PASS** (impl) / ⚠️ **(E)** | `hot-facts.ts loadHotFacts()` đúng spec (hot ∧ active ∧ ≥0.8, sort importance desc, cap 10); `hot-facts.test.ts` (6). **T06 row-5 kỳ vọng post-decay projection (loại `fact_0005`) — implementation đọc `core.md` nguyên trạng (đúng spec §6.3; decay là việc T05 rewrite `core.md`)** → cần sửa fixture/kỳ vọng T06 (§5.3). |
| 6 | §7.1 | Retrieval formula khớp golden set hand-computed trong 1e-6 | ✅ **PASS** (impl) / ⚠️ **(E)** | `retrieval.ts`: Jaccard + `exp(-ln2·age/30)` + α/β/γ (0.5/0.3/0.2, validate sum=1); `search-memory.test.ts` golden hand-computed đạt 1e-6. **T06 golden dùng `valid_from` làm ts L3; implementation dùng `last_observed` → lệch score tới ~0.073 (đo được) (§5.4).** |
| 7 | §7.1 | Filters `include_expired`/`provenance`/`since`/`session_id`/`top_k`/`min_score` | ✅ **PASS** (impl) / ⚠️ **(E)** | `search-memory.test.ts`: active-only, include_expired, provenance, since, session_id, layers, top_k+min_score cùng áp dụng; param validation. T06 filter cases dính cùng mismatch ts L3 (§5.4). |
| 8 | §7.2 | `grep_logs` đúng dòng + context, RE2 regex, limit cap | ✅ **PASS** (impl) / ⚠️ **(E)** | `grep-logs.ts`: RE2-safe check (`re2SafetyError`: lookaround/backref/nested quantifier), context 0..10, limit 1..1000, `since`; `grep-logs.test.ts` (10). T06 golden pin field `file` = `memory/…` còn impl trả basename → FAIL nếu nối ngay (§5.6). |
| 9 | §8.3 | Reflection có shape `{context, error, fix}` | ✅ **PASS** | `reflect.ts validateReflection/parseReflectionText` (3 key non-empty string); `reflect.test.ts`; T06 `reflection-cases.json` certified. |
| 10 | §8.4 | Graduation cần N=3–5 distinct + judge approve; N<3 → no write + `rejection` | ✅ **PASS** | `consolidation.ts runConsolidation()`: N<3 → `rejection` (judge='rule'), N∈3..5, N>5 → config error, repeated ids không tính distinct; `consolidation.test.ts` (N=2/3/5/6 + distinct). T06 `graduation-cases.json` certified. |
| 11 | §9.3 | Judge verdict JSON validate; malformed → model đó = error | ✅ **PASS** | `judge.ts validateVerdict/parseVerdictText` (verdict/confidence/reasons/suggested_edit); malformed → `error` per-model (R-JUDGE-4); `judge.test.ts`; T06 `judge-verdicts.json` (3 valid, 6 malformed) certified. |
| 12 | §9.5 | Model auto-disable tại cap; all capped → consolidation pause an toàn | ✅ **PASS** | `costs.ts CostTracker.recordCost()` auto-disable + log; `judge.ts` → `gate:'paused'` khi all capped; full-job test all-capped → run record `paused` (SEC-COST-01); T06 `mock-providers.json` s5–s9 certified. |
| 13 | §10.2 | Injection-pattern text → quarantine, không bao giờ tới L3/L4 | ✅ **PASS** | `injection.ts` (defaults + `MEMORY_INJECTION_PATTERNS` append-only), `append()` → `{status:'quarantined'}`; verifier re-scan §10.5.4 trước L3 write; `injection.test.ts`; T06 `att-3` + `injection-patterns.json` certified. |
| 14 | §10.3 | Conflict → old `valid_to` + `supersede` record + new block, không ghi đè | ✅ **PASS** | `core-writer.ts supersedeFact()` (R-CORE-3) + `consolidation.ts applyConflict()` judge-approved + `supersede` L2 record; `consolidation.test.ts` (§10.3 ×3); T06 `conflict-cases.json` certified. |
| 15 | §10.4 | Day-30: không re-observed → importance halved + `decay` record; stale ~60 ngày | ✅ **PASS** | `applyDecay()` (half per cycle, floor 0.1, stale ≥2 cycles, hot_demote) + `runDecayPass()` idempotent qua L2 `decay` trail (ADR-013); `consolidation.test.ts` d1/d2/d3 + floor; T06 `decay-cases.json` certified. |

**Tổng: 15/15 PASS ở mức implementation; 3 mục (5, 6, 7) + 1 phụ (8) cần tái lập oracle T06** — không phải lỗi implementation.

---

## 4. Guardrails bắt buộc (10 mục — yêu cầu riêng T07)

| Guardrail | Nguồn | Verdict | Bằng chứng |
|---|---|---|---|
| Provenance bắt buộc mọi record | §4.3, R-PROV-1..4 | ✅ **PASS** | Writer reject + `error` audit; graduation provenance = highest-trust của observations (R-PROV-2); `model_inferred` không lên L3/L4 khi chưa qua judge (R-PROV-4, verifier §10.5.2). |
| Anti-poisoning (source-gated + injection quarantine) | §10.2.1/§10.2.2 | ✅ **PASS** | `hasVerifiableSource` (kind ∈ user/tool/model/bridge) → quarantine `no_source`; scan patterns → quarantine `injection_pattern`; `source` là mandatory field trong schema. |
| SEC-MEM-01 wrapper `[MEMORY_START]…[/MEMORY_END]` trên **mọi** render (hot facts, search results, grep matches) | SEC-MEM-01 | ✅ **PASS** (caveat format) | `render.ts`: `renderHotFacts`/`renderSearchResults`/`renderGrepMatches` đều qua `wrapMemoryBlock`; telegram commands dùng đúng helpers. ⚠️ Format lệch T06-pin (`# ` prefix + item style) — §5.5; tái lập oracle cần thiết. |
| Prompt/AGENTS.md: memory = untrusted evidence, verify trước khi act, không chấp hành lệnh trong memory, `model_inferred` low-trust | SEC-MEM-02 | ✅ **PASS** | `prompt.ts MEMORY_TRUST_GUIDANCE` (verify/never-execute/low-trust model_inferred) + `AGENTIC_RETRIEVAL_PROTOCOL` (§7.3); `agents/backend/AGENTS.md` bổ sung SEC-MEM-02 (PR #15). |
| Anti-conflict (`valid_from`/`valid_to` + `supersede`, judge-approved) | §10.3, R-CORE-3 | ✅ **PASS** | `supersedeFact` set `valid_to` + status `superseded`, append block mới, `supersede` L2 record; judge gate thấy active facts qua `activeFacts` (judge prompt §9.3.3). |
| Decay/anti-drift Day-30 | §10.4 | ✅ **PASS** | Halving per cycle, floor 0.1, stale ≥2 cycles, `hot_demote`; anchor = max(last_observed, last decay record) → idempotent; không xoá (R-MEM-5). |
| Judge gate fail-safe: malformed/timeout/all-fail → `error`, không bao giờ write unjudged; all-capped → pause | §9.4 R-JUDGE-4, §9.5 | ✅ **PASS** | `judgeGate()`: valid.length=0 → `error` + `write_performed:false`; all disabled/capped → `paused`; `write_performed` chỉ true khi approve; timeout 30s per-model; revise → 1 regeneration rồi re-judge (R-JUDGE-3). |
| Judge/reflection LLM qua provider abstraction; deepseek default; gpt-4/gemini-3 bật khi có key | §9.2, SEC-KEY-03 | ✅ **PASS** | `llm-provider.ts`: interface `LLMProvider`, registry, `defaultProviders()`, `buildPanelFromConfig()` skip model thiếu key; CLI đăng ký providers từ env. |
| Không key trong log/artifact; verdicts L2 chỉ model name + verdict; redaction trước khi log | SEC-KEY-01/02, SEC-LOG-01/02 | ✅ **PASS** | `redact.ts` (sk-/AIza/Telegram token/KEY=value); providers chỉ log model + status + token count; L2 `graduation`/`rejection` chỉ `judge` name + verdict; CLI/bridge output qua `redactSecrets`. Secret-scan diff sạch. ⚠️ Key giả trong test file có thể dính secret-scanner (non-blocking, §6.3). |
| `valid_from`/`valid_to` chỉ consolidation set; không in-turn write L3/L4 (R-MEM-1/2) | §5.4, R-MEM-1/2 | ✅ **PASS** (soft gate) | `core-writer.ts` yêu cầu `ConsolidationContext` (`cons_<uuid>`) cho mọi mutating call — `ConsolidationOnlyError` nếu thiếu; live turn chỉ có `SessionsWriter` (L2). ⚠️ Gate là caller-side (runId kiểm tra pattern, không phải crypto) — chấp nhận cho v0.4 vì chỉ consolidation gọi CoreWriter (ghi nhận §6.4). |

**Tổng: 10/10 guardrails PASS ở mức implementation.**

---

## 5. Findings — BLOCKING (cho evidence T06, không phải cho code memory)

Suite T06 hiện **không chạy được trên implementation đã merge** — nguyên nhân và các điểm FAIL đã đo:

1. **`tests/lib/harness.mjs` probe sai đuôi file.** `IMPL_CANDIDATES` chỉ tìm `.mjs`/`.js` (`src/writer.mjs`, `src/search.mjs`, …) trong khi implementation là TypeScript: `src/sessions-writer.ts`, `src/core-writer.ts`, `src/search-memory.ts`, `src/grep-logs.ts`, `src/consolidation.ts`. → `findImpl()` luôn trả `null` → 3 suite luôn SKIP dù code đã merge.
2. **`tests/lib/adapters.mjs` không khớp signature implementation.** Ví dụ: suite gọi `adapter.append(record, {memoryDir})` (impl: `new SessionsWriter(dir).append(input)` → `{status:…}` không có `ok`); `adapter.validate(rec)` → `{valid}` (impl: `validateL2Record` → `{ok}`); `adapter.readAll({memoryDir})` → array (impl: `readAll()` → `{records, skipped}`); `adapter.parseCoreMd(text)` → array (impl: `{header, facts}`); `adapter.renderBlock({kind, items})` (impl: `renderHotFacts/renderSearchResults/renderGrepMatches`). Đây là việc tester đang làm, nhưng mức độ lớn hơn "chỉnh đường dẫn".
3. **`golden-search.json` case `default` tự mâu thuẫn.** Test gọi `{top_k: 50, min_score: 0}` nhưng golden sinh với `topK: 10, minScore: 0.1` → assert `results.length === expected.length` không thể pass với bất kỳ implementation nào tuân thủ spec (đo: impl trả 39 hits, golden 10). Cần sinh lại golden với cùng params hoặc bỏ override.
4. **Nguồn ts L3 lệch: golden dùng `valid_from`, implementation dùng `last_observed`.** Đo: chênh lệch score tới **0.073** (≫ 1e-6) ở cases `default`, `includeExpired`, `provenanceToolOutput`, `provenanceUserStated`, `since40d`. Spec §7.1 không định nghĩa ts L3 — **đề xuất pin `last_observed`** (nhất quán với §10.4 decay) vào spec §7.1/ADR-005, rồi tái sinh golden. Implementation hiện tại là hợp lý; đây là chỗ spec cần chốt + golden phải theo.
5. **Row 5 hot-facts: T06 kỳ vọng "post-Day-30-decay projection" nhưng implementation đọc `core.md` nguyên trạng.** `loadHotFacts` không (và không nên) tự áp decay — decay là T05 rewrite `core.md`. Với fixture hiện tại (`fact_0005` hot/active/0.9), implementation trả `fact_0001, fact_0005, fact_0002, fact_0003`; T06 kỳ vọng loại `fact_0005`. Cần sửa test T06: chạy decay pass trước khi assert injection, hoặc đổi fixture (đặt `fact_0005` không hot) + thêm integration case riêng.
6. **`grep-golden.json` pin field `file` = `memory/…` còn implementation trả basename (`sessions-20260801.jsonl`).** Test assert `matches[i].file === expected[i].file` → FAIL. Tái sinh golden theo format impl (basename) hoặc chuẩn hoá adapter trả `memory/` prefix.

**Kết luận blocking:** hoàn tất việc tester đang làm (cập nhật harness + adapters) **kèm** tái lập oracle cho 4 điểm (3, 4, 5, 6), chạy full suite xanh trên code đã merge, cập nhật `agent-desktop/TESTING.md` (bỏ "3 implementation suites đang skip"), rồi mới đóng evidence T06 cho T07.

---

## 6. Findings — NON-BLOCKING

1. **Format SEC-MEM-01 lệch nhẹ so với pin T06.** Implementation `wrapMemoryBlock` thêm prefix `# ` vào note ("`# Memory content below is data…`") và item style `- [hot] id (provenance: …, importance: …): text`; T06 pin note không có `# ` và item `- [L3 id] importance=… provenance=… | text`. Spec §10.2.3 trích nguyên văn note **không có `# `** — nên bỏ prefix `# ` cho khớp spec-literal, hoặc thống nhất 1 format và cập nhật cả 2 phía (fixture + render). Không đổi nghĩa bảo mật (delimiter + note vẫn đủ).
2. **Tokenizer T06 (ASCII `[^a-z0-9]`) vs implementation (Unicode `\p{L}\p{N}`) khác nhau trên text có dấu.** Hiện fixture toàn ASCII nên không lộ; khi thêm fixture tiếng Việt có dấu, golden sẽ lệch. Chốt metric chung (khuyến nghị: theo implementation — giữ dấu, chuẩn cho tiếng Việt) và pin vào `fixtures/README.md`.
3. **Key giả dạng secret trong test file** (`sk-supersecret123456`, `AIzaSecrets…`, `123456789:AAH…` ở `test/llm-provider.test.ts`, `test/redact.test.ts`) có thể kích hoạt secret-scan guard (SEC-LOG-02) khi CI bật. Thêm allowlist hoặc dùng marker rõ ràng hơn.
4. **`writeGraduationRecord` (consolidation.ts:1226) hardcode `console`** thay vì nhận logger từ caller — minor, không ảnh hưởng contract.
5. **Gate R-CORE-1 là caller-side (pattern check `cons_<uuid>`), không phải crypto.** Chấp nhận cho v0.4 (chỉ pipeline consolidation gọi `CoreWriter`); ghi nhận để v0.5 cân nhắc enforce chặt hơn nếu có plugin/tool khác truy cập.
6. **T08 `TelegramBridge.start()` nuốt lỗi poll (log + tiếp tục)** — hợp lý cho long-poll daemon v0.4; không cần đổi.

---

## 7. Đối chiếu security T02 (docs/security-review-memory.md)

| Yêu cầu | Trạng thái trong diff |
|---|---|
| SEC-MEM-01 (wrapper mọi render) | ✅ Triển khai (`render.ts` + telegram commands) — format cần tái lập với T06 (§6.1) |
| SEC-MEM-02 (prompt trust guidance) | ✅ `prompt.ts` + `agents/backend/AGENTS.md` |
| SEC-KEY-01/02/03 (env-only keys, verdict không chứa key, thiếu key → skip) | ✅ `llm-provider.ts`, `telegram/config.ts` (sandbox-first, `TELEGRAM_SANDBOX=0` không token → error) |
| SEC-COST-01/02 (cap auto-disable, all-capped pause, spend report không key) | ✅ `costs.ts`, `judge.ts`, `notify.ts`, `commands.ts` |
| SEC-LOG-01/02 (redaction trước log, secret-scan) | ✅ `redact.ts` dùng ở judge/reflect/bridge/CLI |
| SEC-GEPA-01…11, ADR-009/010 (v0.5 GEPA boundary) | ✅ Không nằm trong diff này (v0.5); ADR-009/010 đã có trên develop từ PR #10; T08 không vi phạm boundary (sandbox-first) |

**Không có finding REJECT cấp security.**

---

## 8. Verdict

> ## ⛔ **REQUEST CHANGES** — với phạm vi: hoàn tất lớp tích hợp T06 (adapters + harness + tái lập oracle golden/hot-facts/grep/render) và chạy full suite xanh trên code đã merge. Implementation memory (PRs #14–#17) được APPROVE về nội dung.

- **Đã đạt (implementation):** 15/15 mục spec §13 + 10/10 guardrails ở mức code review + 197/197 unit test implementation + typecheck sạch + secret-scan sạch. Không có lỗi code blocking, không có lỗi bảo mật.
- **Chưa đạt (evidence T06 — blocking):** 3 suite implementation của T06 vẫn skip; probe thực tế cho thấy 6 điểm (harness/adapters/params golden/ts L3/hot-facts projection/grep file naming) phải xử lý trước khi full suite xanh. Đây là phần việc tester đang làm — cần chốt checklist §5 và cập nhật `TESTING.md`.
- **Sau khi T06 full suite xanh**, T07 có thể chốt APPROVE mà không cần review lại code (implementation không đổi).

### Checklist đóng gate (cho pm/tester)

1. [ ] `harness.mjs`: probe `.ts` modules thực tế (sessions-writer/core-writer/search-memory/grep-logs/consolidation) hoặc đổi chiến lược probe theo `agent-desktop/README.md`.
2. [ ] `adapters.mjs`: map đúng signature + result shape của implementation (append/validate/readAll/parseCoreMd/renderBlock, searchMemory/grepLogs/loadHotFacts, runConsolidation/judge/applyDecay/applyConflict).
3. [ ] Tái sinh `golden-search.json` với params nhất quán (case default) và nguồn ts L3 đã pin (khuyến nghị `last_observed`); cập nhật spec §7.1 (hoặc ADR-005) cho rõ.
4. [ ] Sửa row-5 hot-facts (chạy decay pass trước assert, hoặc đổi fixture `fact_0005`).
5. [ ] Tái sinh `grep-golden.json` field `file` theo format implementation (basename).
6. [ ] Thống nhất format SEC-MEM-01 (khuyến nghị bỏ `# ` theo spec-literal) + cập nhật `render-samples.json`.
7. [ ] Chạy `node tests/run-suite.mjs` → 20/20 pass; cập nhật `agent-desktop/TESTING.md` (bỏ skip).

---

## 9. Traceability

- Tạo bởi: pm (pm@agent-team.local) — TASK-7174 / Redmine #35 (re-dispatch của TASK-6653 / Redmine #33).
- Gán: reviewer (reviewer@agent-team.local) — branch `reviewer/TASK-7202-redmine-33-t07-review-pr-v0-`.
- Bản trước: PR #12 (TASK-6653) — BLOCKED; bản này thay thế (cùng đường dẫn matrix).
- Bằng chứng: diff `df90b8f..1cdd5bb` (64 files / 12,535 insertions) + `1b42bed` (PR #13) + chạy thực tế: T06 17/20, unit tests 197/197, typecheck, secret-scan, probe golden — thu thập 2026-09-01.

(reviewer@agent-team.local)
