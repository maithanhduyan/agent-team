# MONTHLY CLOSING SKILL (Kết toán tháng)

The accountant agent's end-to-end procedure for producing the
**monthly closing report pack** from Odoo, in Vietnamese accounting
practice (VAS-based). Read this skill fully before starting a
closing task and follow every step.

## 1. Scope and period

- The closing period comes from the task description
  (`Kết toán tháng YYYY-MM`). If absent, use the **previous calendar
  month**. Start = `YYYY-MM-01`, end = last day of the month.
- "Period balances" = posted move lines with `date` inside the
  period. "YTD balances" = posted move lines with `date <= end` of
  the period, within the current fiscal year when derivable.

## 2. Always discover first

Odoo field names and models differ across versions (16-19). Before
querying anything:

1. `mcp__odoo__health_check` and `mcp__odoo__get_odoo_profile` —
   confirm the connection, server version, database, user context.
2. `mcp__odoo__list_models` — confirm these models exist:
   `account.move`, `account.move.line`, `account.account`,
   `account.tax`, `account.journal`, `account.report`, `res.partner`,
   `account.payment`.
3. `mcp__odoo__get_model_fields` on `account.move`,
   `account.move.line`, `account.account`, `account.tax` — confirm
   field names (e.g. `date` vs `invoice_date`; `account_type` vs
   `internal_type` on `account.account`).
4. Pull the chart of accounts: `mcp__odoo__search_records`
   model=`account.account`, domain=`[["deprecated","=",false]]`,
   fields `["code","name","account_type","reconcile"]` (fall back to
   `internal_type` on Odoo < 17). This is your mapping source.

## 3. Data pulls

All date domains below assume `account.move.line.date` (the entry
date). Verify the field with discovery; use `invoice_date`/`date` on
`account.move` only when line dates are not suitable.

### 3.1 Trial balance (period and YTD)

`mcp__odoo__aggregate_records` on `account.move.line`:

- groupby `["account_id"]`, domain
  `[["date",">=",START],["date","<=",END],["state","=","posted"]]`,
  sums: `["debit:sum","credit:sum","balance:sum"]` (confirm the
  fields; `balance` may be computed — compute `debit - credit`
  yourself if needed).
- Repeat with `[["date","<=",END],["state","=","posted"]]` for YTD
  balances (for the balance sheet).

Then join against the chart of accounts (`account_id` → code/name/
type) yourself. A row per account: code, name, type, debit, credit,
balance (period), balance (YTD).

### 3.2 P&L data (period)

From the trial balance, keep accounts whose `account_type` is
`income` or `expense` (fall back: `internal_type` in
`["income","expense"]`). Sum by type and by the VAS line mapping
below. Also pull `account.move` for the period for context:
domain `[["state","=","posted"],["date",">=",START],["date","<=",END]]`,
fields `["name","ref","partner_id","journal_id","amount_total",
"amount_untaxed","payment_state"]` (adjust per discovery) — this is
your journal listing for the closing summary.

### 3.3 Balance sheet data (as of end of period)

From the YTD trial balance, keep accounts with `account_type` in
`asset`, `liability`, `equity`, `payable`, `receivable`, `liquidity`
(fall back: `internal_type`). These are balance-sheet accounts:
report **cumulative** balances as of `END` (not just the period).

### 3.4 VAT data (period)

Odoo materialises VAT on posted move lines as tax-account lines:

- `mcp__odoo__aggregate_records` on `account.move.line`, domain
  `[["date",">=",START],["date","<=",END],["state","=","posted"],
  ["tax_line_id","!=",false]]`, groupby `["tax_line_id"]`, sum
  `["debit:sum","credit:sum","balance:sum"]`.
- Join against `account.tax` (`mcp__odoo__search_records` fields
  `["name","amount","type_tax_use","tax_scope","amount_type"]`):
  - **Đầu ra (output VAT)** = balance of sale taxes (`type_tax_use`
    = `sale`, `tax_scope` = `vat`).
  - **Đầu vào (input VAT)** = balance of purchase taxes
    (`type_tax_use` = `purchase`).
  - **Thuế phải nộp** = output − input (negative = được khấu trừ
    sang kỳ sau).
- If a Vietnamese localization report exists (`account.report` rows
  containing "GTGT" / "Tờ khai" / "VAT"), note its name in the report
  as the authoritative cross-check, but compute the summary from
  move-line data as above.

### 3.5 AR/AP, open items, backlog

- `mcp__odoo__receivable_payable_aging` — aged AR/AP by partner.
- `mcp__odoo__accounting_health_summary` — open receivable/payable
  item counts + draft invoice backlog.
- Unreconciled partner lines: `mcp__odoo__search_records` on
  `account.move.line`, domain
  `[["account_id.account_type","in",["receivable","payable"]],
  ["reconciled","=",false],["date","<=",END]]` (adjust to
  `account_id.internal_type` when needed), fields
  `["date","name","partner_id","account_id","balance","amount_residual"]`
  limited to a bounded slice (e.g. 200 rows) — flag the count.

## 4. Validation checklist (kết toán checklist)

Run each check; record PASS/FAIL/WARN with numbers in the summary:

1. **Balanced period**: sum(debit) == sum(credit) over all posted
   lines in the period (tolerance 0.01 per currency).
2. **No drafts in period**: `account.move` with
   `[["state","=","draft"],["date",">=",START],["date","<=",END]]` —
   must be 0 (WARN otherwise; drafts are expected only when the
   business posts late).
3. **No cancelled/voided surprises**: count moves in state `cancel`
   dated in period.
4. **Trial balance squares**: total debit == total credit in the
   period trial balance.
5. **VAT sanity**: output tax accounts have no debit-side netting
   (WARN on negative balances); input VAT not negative.
6. **AR/AP aging**: totals from aging equal the balance-sheet
   receivable/payable YTD balances (within tolerance); report
   differences explicitly.
7. **Draft backlog**: count of draft invoices/bills (from
   `accounting_health_summary`).
8. **Unreconciled items**: count and total `amount_residual` as of
   END.

## 5. Report pack — deliverables

Create `reports/<YYYY-MM>/` in the workspace and write:

| File | Content |
|---|---|
| `BC-KQKD-<YYYY-MM>.md` | P&L — Báo cáo kết quả hoạt động kinh doanh (template below), period + YTD |
| `BC-CDK-T-<YYYY-MM>.md` | Balance sheet — Bảng cân đối kế toán (tóm tắt theo nhóm tài khoản), as of END |
| `TK-GTGT-<YYYY-MM>.md` | VAT — Tờ khai thuế GTGT tóm tắt: đầu ra, đầu vào, phải nộp/kỳ sau |
| `trial-balance-<YYYY-MM>.csv` | Full trial balance (period + YTD) — the raw ledger table |
| `ar-ap-aging-<YYYY-MM>.csv` | Aged AR/AP table from `receivable_payable_aging` |
| `closing-summary-<YYYY-MM>.md` | Tổng hợp kết toán: period, key figures, checklist results, anomalies, assumptions |

Amounts: use the company currency; thousands separators, no decimals
for display, exact decimals in CSV. State the currency and the
exchange-rate assumption (if any) in every report.

### 5.1 P&L template (B02-DN lines)

| Line | VAS item | Source |
|---|---|---|
| 01 | Doanh thu bán hàng và cung cấp dịch vụ | income, code 511* (or 7xx/9xx if no 5xx) |
| 02 | Các khoản giảm trừ doanh thu | income/contra, codes 521* |
| 10 | Doanh thu thuần | 01 − 02 |
| 11 | Giá vốn hàng bán | expense, code 632* |
| 20 | Lợi nhuận gộp | 10 − 11 |
| 21 | Doanh thu hoạt động tài chính | income, code 515* |
| 22 | Chi phí tài chính | expense, code 635* |
| 24 | Chi phí bán hàng | expense, code 641* |
| 25 | Chi phí quản lý doanh nghiệp | expense, code 642* |
| 30 | Lợi nhuận thuần từ HĐKD | 20 + 21 − 22 − 24 − 25 |
| 31 | Thu nhập khác | income, code 711* |
| 32 | Chi phí khác | expense, code 811* |
| 40 | Lợi nhuận kế toán trước thuế | 30 + 31 − 32 |
| 51 | Chi phí thuế TNDN | expense, code 821* |
| 60 | Lợi nhuận sau thuế | 40 − 51 |

Mapping rule: match by `account_type` first; use code prefixes only
as a heuristic because charts differ per company. Document every
non-obvious mapping in the report. Unmapped income/expense accounts
go to an "Unmapped (cần xem xét)" section — never silently drop
them.

### 5.2 Balance sheet summary template (B01-DN groups)

- **A. Tài sản ngắn hạn**: liquidity + receivable (short-term) +
  inventory (`account_type` asset with codes 151-158*) + other
  current assets (codes 13*, 14*, 15* excluding inventory).
- **B. Tài sản dài hạn**: remaining asset accounts (fixed assets
  211-214*, investments, other long-term).
- **C. Nợ phải trả**: payable + liability accounts (331*, 333*,
  341*, ...). Split: ngắn hạn / dài hạn when derivable from codes.
- **D. Vốn chủ sở hữu**: equity accounts (411*, 421*, ...).
- Check A + B == C + D within tolerance; report the difference.

### 5.3 VAT summary template (01/GTGT)

| Chỉ tiêu | Nội dung | Số tiền |
|---|---|---|
| [23] | Doanh thu chịu thuế trong kỳ (untaxed amount of sale moves, period) | |
| [24]/[25] | Thuế GTGT đầu ra (sale `tax_line_id` balances) | |
| [26]/[27] | Thuế GTGT đầu vào được khấu trừ (purchase `tax_line_id` balances) | |
| [40] | Thuế GTGT phải nộp (24+25 − 26−27 adjustments) | |

Label the report as a **tóm tắt nội bộ** (internal summary) — the
official declaration is filed by the human accountant.

## 6. Quality rules

- Every figure must be traceable to a query: record the tool call
  (model, domain) in the closing summary or a `notes` section.
- Never invent data. Empty result sets are reported as 0 with a note
  ("no data for period"), never as a plausible guess.
- If `mcp__odoo__*` tools are absent, stop data work, write
  `closing-summary` documenting the failure, and mark the task failed
  with the reason.
- Keep reports machine-readable: CSVs with headers, Markdown tables
  for the VAS reports, ISO dates (`YYYY-MM-DD`), period key
  `YYYY-MM`.

## 7. Deliverables — workspace-local, never pushed

The report pack contains **confidential business data**. Per
`SECURITY.md` (Agent Security Policy) and AGENTS.md:

1. Write `reports/<YYYY-MM>/` and update `MONTHLY-CLOSING-LOG.md`
   (period, status, key figures, anomalies) **in the workspace
   only**.
2. **Never `git add`/commit/push** the report pack, the log, or any
   business figures — no branch, no Pull Request — unless the task
   description explicitly names an authorized **private**
   destination.
3. Do not quote real figures in commit messages, Redmine, or any
   public channel; the orchestrator result summary may carry key
   figures (that channel is internal to the team).
4. If a task explicitly authorizes a private repository: follow the
   GIT BRANCHING SKILL (`accountant/TASK-<id>-<slug>`), commit only
   the authorized artifacts, push, open the PR.
5. In the orchestrator result summary include: period, revenue,
   profit before/after tax, VAT payable, total assets, top
   anomalies.

## 8. Odoo version compatibility (verified on Odoo 15.0)

Detect the version via `mcp__odoo__get_odoo_profile` and adapt:

- **`account.move.line` has NO `state` field on Odoo 15** — use
  `parent_state` (related to `move_id.state`), e.g.
  `[["parent_state","=","posted"]]`. This is the single most common
  query failure.
- **`account.account` has NO `account_type` on Odoo 15** — use
  `internal_type` (liquidity/receivable/payable/asset/liability/
  equity/income/expense/other) and `internal_group`
  (asset/liability/equity/income/expense). Note: in the field-tested
  ledger most accounts leave `internal_type` at `other` —
  prefer `internal_group` for balance-sheet classification and
  `internal_type` only for receivable/payable.
- **`accounting_health_summary` is broken on Odoo 15** (the tool
  queries `account.account.account_type`, which does not exist
  there) — compute the backlog/open-item numbers yourself with
  `search_records`/`aggregate_records`.
- **`receivable_payable_aging` fails on Odoo 15** for the same
  reason — compute AR/AP aging from `account.move.line` directly
  (domain: `account_id.internal_type ∈ [receivable,payable]`,
  `reconciled=false`, `date ≤ end`), bucketed by `date_due` or by
  days from `date` when `date_due` is not reliable.
- Odoo 15 `aggregate_records` uses `read_group` and returns an extra
  `__count` row per group — ignore it or use it as line count.
- Filter by move-line `date` (entry date), not `create_date`.

## 9. MCP tools absent (Odoo bridge)

If `mcp__odoo__*` tools are absent in the session:

1. Check the bridge is healthy and the credentials are set (host
   side: `docker compose ps odoo-mcp`, `docker compose logs
   odoo-mcp`).
2. Known root cause: the FastMCP bridge rejects the DSH client's
   `Host: odoo-mcp:8000` header with HTTP 421 unless
   `MCP_ALLOWED_HOSTS` includes it (fixed in
   `compose.integrations.yaml` — keep that env in sync).
3. Fallback: you may query the bridge directly over HTTP from the
   workspace with a tiny Python MCP client (initialize + tools/call
   with `Accept: application/json, text/event-stream`), exactly like
   the reference implementation used for the 2026-07 pack. Never
   fabricate figures; if Odoo is truly unreachable, write the
   failure summary and mark the run failed per §6.
