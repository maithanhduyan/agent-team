---
name: github-workflow
description: GITHUB WORKFLOW SKILL - Use the official GitHub MCP bridge (mcp__github__* tools) for pull requests, issues, repositories, and Actions instead of raw curl. Read this skill before creating or reviewing PRs/issues.
---

# GITHUB WORKFLOW (MCP)

Your DSH session exposes the official GitHub MCP server as
`mcp__github__<tool>` (e.g. `mcp__github__get_me`,
`mcp__github__create_pull_request`). The `github-mcp` service holds
the token; you authenticate through it and **never** print or commit
tokens.

## 1. Availability

- Tools appear only if the bridge is up. If `mcp__github__*` is
  missing, fall back to `curl` with `$GITHUB_TOKEN` (see the
  git-branching skill) and note it in your result.
- Start with `mcp__github__get_me` to confirm identity and that the
  token works.

## 2. Common flows

Tool names below are the current server's; always confirm exact
signatures via the tool list DSH shows you (they can change between
server versions).

### Create a pull request

```text
mcp__github__create_pull_request
  owner: <owner>  repo: <repo>  base: develop  head: <your-branch>
  title: "TASK-007: <summary>"  body: "What/Why/How + evidence"
```

### Review another agent's PR (reviewer)

1. `mcp__github__list_pull_requests {owner, repo, state: "open"}` —
   find the PR number and head branch.
2. `mcp__github__pull_request_read {owner, repo, pull_number}` —
   description and state; `mcp__github__list_commits` / `get_commit`
   for the change set.
3. `mcp__github__get_file_contents {owner, repo, path, ref: "<head-branch>"}`
   — read the actual code on the PR branch.
4. Comment your verdict:
   - `mcp__github__pull_request_review_write {owner, repo, pull_number,
     event: "APPROVE"|"REQUEST_CHANGES", body: "..."}` for the formal
     verdict, or `mcp__github__add_issue_comment` for a plain note
     (per-file comments: `add_reply_to_pull_request_comment`).

### Issues (pm / anyone)

- `mcp__github__issue_write {owner, repo, ...}` — create/update issues
  (check the tool's fields); `mcp__github__issue_read` to read,
  `mcp__github__list_issues {owner, repo, state: "open"}` to list.

### Actions (when CI is wired)

- `mcp__github__actions_list {owner, repo, method: "list_workflow_runs"}`
- `mcp__github__get_job_logs {owner, repo, run_id, return_content: true}`
  — read failures instead of guessing.

## 3. Rules

- The orchestrator assigns your branch name
  (`<agent>/TASK-<id>-<slug>`); PRs use `base: develop` (the
  repository's default branch — confirm with
  `mcp__github__get_repository`).
- PR titles start with `TASK-<id>:` so the team can trace work.
- Never create PRs from `main`/`develop` directly; never merge
  without an explicit task requirement.
- Report the PR URL in your task result summary.
- Tool names/signatures change between server versions: when in
  doubt, call `mcp__github__get_me` or inspect the tool list DSH
  shows you, and adapt.
