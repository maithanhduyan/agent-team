# Decisions

Architectural decision log. Entries are append-only — add new decisions at the
bottom with a date, status, context, decision, and consequences.

---

## Frontend app shell stack (TASK-175)

- **Date:** 2026-08-30
- **Status:** Accepted
- **Context:** TASK-175 scaffolds the frontend app shell with routing and a
  placeholder home page. The repo had no product frontend yet — `dashboard/`
  is a single-file static task board (nginx + HTML), not the product UI — and
  an earlier, unmerged attempt (TASK-002) placed a bare Vite scaffold at the
  repo root with no routing.
- **Decision:** Build the product frontend as a self-contained
  **Vite + React + TypeScript** single-page app under `frontend/`, using
  **React Router 6** (`BrowserRouter`) for client-side routing. The app shell
  (header / main / footer) is a pathless layout route in `src/layouts` +
  `src/components`; pages live in `src/pages`. The placeholder home page is
  served at `/` and unknown paths render a 404 page. Tests use **Vitest 2 +
  Testing Library** (jsdom), with the shell's dark palette mirroring the
  existing dashboard UI.
- **Consequences:** `frontend/` is fully self-contained (own `package.json`,
  committed lockfile) so the repo root stays clean and the tester agent can
  run `cd frontend && npm ci && npm run dev` to drive the UI. The plain-CSS
  styling is intentionally placeholder-grade; a design system/component
  library can be introduced later without changing the route structure.
