---
name: ui-testing
description: UI TESTING SKILL - Drive a real headless Chromium through the Playwright MCP bridge (mcp__playwright__* tools) to test the web frontend: start the app under test, navigate, snapshot, interact, assert, and produce screenshot evidence for PRs. Read this skill before any UI testing work.
---

# UI TESTING WITH PLAYWRIGHT (MCP)

The team runs real browser tests through the `playwright-mcp` service.
Your DSH session exposes its tools as `mcp__playwright__<tool>` — e.g.
`mcp__playwright__browser_navigate`. The browser runs headless
Chromium inside its own container; you drive it over MCP and never
launch a browser yourself.

## 0. Tool availability

- If `mcp__playwright__*` tools are missing (bridge down), fall back
  to static/API checks and **note it in your result** — never block
  the pipeline. The bridge reconnects automatically.
- The first `browser_navigate` on a cold server can take ~30–60s
  (browser boot); be patient and retry once if it times out.

## 1. Prepare the app under test

Your workspace is an isolated copy of the repo. The code to test
usually lives on another agent's branch (e.g. `frontend/TASK-007-*`):

```bash
git fetch origin
git checkout -b <your-branch> origin/develop   # your own tester branch
git merge origin/frontend/TASK-007-login       # or: git checkout origin/frontend/TASK-... and copy files
```

Then install and start the app **in the background** (the bash tool
must return, so detach the server):

```bash
cd /workspace/project
npm ci 2>/dev/null || npm install
# Vite / plain static build:
setsid nohup npx vite --host 0.0.0.0 --port 5173 > /tmp/app.log 2>&1 &
# Fallback: build once, serve statically:
#   npx vite build && setsid nohup python3 -m http.server 5173 --directory dist > /tmp/app.log 2>&1 &
```

Verify it is up **before** touching the browser:

```bash
sleep 3; curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5173/
# -> expect 200; if not, read /tmp/app.log and fix
```

If the server dies when the bash call ends (still killed despite
`setsid`), start it with `nohup` plus a short `sleep` in the same
call, or use the static-build fallback — and record the working
recipe in `TESTING.md`.

## 2. Drive the browser

Core loop — navigate, snapshot, act, assert:

1. `mcp__playwright__browser_navigate {url: "http://127.0.0.1:5173/"}`
   (the app is reachable from the playwright container via the
   tester workspace's server on the compose network — if not, use
   the host-visible URL pattern documented in TESTING.md).
2. `mcp__playwright__browser_snapshot` → read the accessibility
   tree; use exact `target` references from it for interactions.
3. `mcp__playwright__browser_click` / `browser_type` /
   `browser_select_option` / `browser_press_key` to act.
4. Assert with the testing-cap tools:
   - `browser_verify_element_visible {role, accessibleName}`
   - `browser_verify_text_visible {text}`
   - `browser_verify_value {type, element, target, value}`
   - `browser_verify_list_visible {element, target, items}`
5. `mcp__playwright__browser_take_screenshot {filename: "TASK-<id>-<step>.png"}` —
   evidence is saved into `/artifacts` (shared with your workspace at
   `/workspace/project/artifacts/`); copy it into the repo before
   committing: `cp /workspace/project/artifacts/TASK-*.png .`
6. Inspect failures: `browser_network_requests` (look for failed
   API calls), `browser_console_messages` if available, screenshot.

Useful extras:
- `browser_tabs {action: "new", url}` — open more pages.
- `browser_wait_for {text}` — wait for async content.
- `browser_run_code_unsafe {code}` — arbitrary Playwright JS for
  complex flows (last resort; prefer the dedicated tools).

## 3. Record results

- Update `TESTING.md`: per acceptance criterion — PASS/FAIL, steps,
  expected vs actual, evidence file names.
- A failing check = bug: file a Redmine issue (see AGENTS.md
  Redmine rules) with the reproduction and attach the screenshot
  filename, then reference `Redmine issue: #<id>` in the report.

## 4. Deliver

- Commit tests + `TESTING.md` + screenshots on your branch
  (`tester/TASK-<id>-<slug>`), push, open a PR (see the
  git-branching skill for auth notes).
- Never commit `/tmp` logs or node_modules.
- Report in your final summary: app URL, scenarios run, verdicts,
  evidence list, PR URL.
