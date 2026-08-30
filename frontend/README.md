# agent-team — frontend

The product frontend: a **Vite + React + TypeScript** single-page app with an
app shell (header / main / footer) and **React Router** client-side routing.

## Stack

- [Vite](https://vite.dev) 5 + [React](https://react.dev) 18 + TypeScript 5.6
- [React Router](https://reactrouter.com) 6 (`BrowserRouter`)
- [Vitest](https://vitest.dev) 2 + [Testing Library](https://testing-library.com)
  for component and interaction tests

## Prerequisites

- Node.js 18+ (pnpm/npm both work; `package-lock.json` is committed for `npm ci`)

## Commands

```bash
npm ci            # install from the lockfile
npm run dev       # dev server → http://localhost:5173
npm run build     # type-check (tsc) + production build → dist/
npm run preview   # preview the production build
npm test          # run the Vitest suite once
npm run test:watch
```

## Routes

| Path  | Page                    |
| ----- | ----------------------- |
| `/`   | Placeholder home page   |
| `*`   | 404 — page not found    |

The shell (`src/layouts/AppLayout.tsx`) renders the header, the active route
via `<Outlet />`, and the footer. Routes are declared in `src/App.tsx`.

## Structure

```text
frontend/
├── index.html            # Vite entry HTML
├── vite.config.ts        # Vite + Vitest config
├── tsconfig.json
└── src/
    ├── main.tsx          # React bootstrap + BrowserRouter
    ├── App.tsx           # route table (shell layout + pages)
    ├── index.css         # shell styles (dark theme, matches dashboard)
    ├── setupTests.ts     # jest-dom matchers for Vitest
    ├── components/       # AppHeader, AppFooter
    ├── layouts/          # AppLayout (the shell)
    └── pages/            # HomePage, NotFoundPage
```

## Notes

- The dark palette mirrors the repo's existing dashboard UI
  (`dashboard/html/index.html`).
- Styling is intentionally plain CSS for the placeholder shell — a design
  system/component library can replace it without changing the routes.
