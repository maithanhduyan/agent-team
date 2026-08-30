# Agent Security Policy

**Applies to:** every DSH agent in this team (pm, ba, backend,
frontend, tester, reviewer, cto, **accountant**, owner) and to every
human operating this stack. The accountant agent's obligations are
the strictest because it handles **financial and business data**.

## 1. Data classification

| Class | Examples | Allowed destinations |
|---|---|---|
| **CONFIDENTIAL — business data** | ledger figures, revenues, assets, debts, VAT/tax numbers, customer/supplier data, `account.move`/`account.move.line` contents, any output of a closing run | workspace only (`workspaces/<agent>/`), orchestrator run results, private channels explicitly authorized by the business owner |
| **CREDENTIALS** | Odoo password/API key, `DEEPSEEK_API_KEY`, `GITHUB_TOKEN`, `REDMINE_API_KEY`, any `*.env` file | `.env` (gitignored) and the MCP bridge containers ONLY |
| **PUBLIC — reusable software** | source code, compose files, Dockerfiles, agent skills (`AGENTS.md`, `SKILL.md`), templates, documentation without business figures | the repository (git) |

## 2. What may NEVER happen

- ❌ Commit, push, or open a Pull Request containing **report packs
  with real business figures** (e.g. `reports/<period>/*`, trial
  balances, P&L, balance sheet, VAT summaries, AR/AP aging) — to any
  repository, public or private, unless a human explicitly
  authorizes a designated private destination.
- ❌ Commit `*.env`, tokens, passwords, API keys, or connection
  strings (even "temporarily" or "for testing").
- ❌ Write credentials into workspace files, logs, run summaries,
  commit messages, or Redmine/GitHub comments.
- ❌ Push branches containing historical sensitive commits and then
  "delete" them later — history is public the moment it is pushed to
  a public repository.
- ❌ Fabricate, guess, or round business figures "for the report".

## 3. Accountant agent rules (enforced)

1. Closing report packs are **workspace-local deliverables**. They
   are never committed to git and never pushed.
2. `MONTHLY-CLOSING-LOG.md` and `reports/<YYYY-MM>/` stay in the
   workspace. The human sees them on the host and receives the
   summary through the orchestrator run result.
3. If a task description explicitly authorizes a named **private**
   destination, follow it exactly; otherwise the default (local
   only) applies.
4. Credentials are never read, printed, or stored by the agent; the
   `odoo-mcp` bridge holds them and the agent only calls
   `mcp__odoo__*` tools.
5. Anomalies are flagged in the reports (checklist + findings), never
   "silently fixed" in the data.

Enforcement points: this policy, `agents/accountant/AGENTS.md`,
`agents/skills/monthly-closing/SKILL.md`, and the orchestrator task
prompt (agents whose deliverables are confidential receive
no-push/no-PR instructions).

## 4. Incident response (if data was ever exposed)

1. **Immediately** close the PR and delete the remote branch
   (`PATCH /pulls/:n {state:closed}` then
   `DELETE /git/refs/heads/<branch>`).
2. Audit for other traces: open PRs, branches, forks, raw URLs.
3. If the repository is public, assume the data may have been
   cached/forked; contact GitHub Support to purge the commit data,
   and consider making the repository private.
4. Rotate any credential that appeared in logs or commit metadata.
5. Record the incident and remediation in the run log and in this
   policy's changelog so the same mistake cannot recur.

### Incident log

| Date | What happened | Remediation |
|---|---|---|
| 2026-08-30 | A closing report pack with real ledger figures was pushed to the public repository as PR #15 | PR closed, remote branch deleted, raw URLs return 404; no-push rule added to AGENTS.md / SKILL.md / orchestrator prompt; this policy created. Repository kept public for the software/skills it hosts; the exposed report content is unreachable via any ref. |

## 5. Review checklist (before any push by any agent)

- [ ] Contains no `reports/`, no `.env*`, no tokens, no business figures?
- [ ] No company/database names, internal hostnames or paths?
- [ ] Only source code, skills, templates, and generic documentation?

If any box is unchecked, **do not push** — leave the work in the
workspace and report.
