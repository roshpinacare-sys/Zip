---
name: fleet-conventions
description: Hard laws of the sovereign fleet — sticky footer, shadcn/ui first, no indigo/blue unless requested, relative API paths with XTransformPort, z-ai-web-dev-sdk backend-only, prisma schema rules, port 3000 only, mobile-first responsive, long-list scroll caps.
user-invocable: true
---

# Fleet Conventions (Sovereign Laws)

Apply these rules when reviewing any diff in this repository. A violation of a rule marked **[BLOCKER]** means verdict=block for that finding.

## Layout & UI

- **[BLOCKER] Sticky footer**: every page with a footer must use a root wrapper `min-h-screen flex flex-col` and the footer must carry `mt-auto` — footer sticks to viewport bottom on short pages and is pushed down naturally on long ones. Never `fixed` overlays over content.
- shadcn/ui components from `src/components/ui` are preferred over hand-rolled equivalents. Rebuilding an existing shadcn primitive from scratch is a finding (severity major).
- **[BLOCKER] Colors**: no `indigo`/`blue` classes or hex unless the user explicitly requested them. Violations: `text-indigo-500`, `bg-blue-600`, `#3b82f6` etc.
- Cards: consistent padding (`p-4`/`p-6`) and spacing (`gap-4`/`gap-6`); misaligned mixes are findings (minor).
- Long lists: cap with `max-h-96 overflow-y-auto` + custom scrollbar styling; unbounded renders of long lists are findings (major).
- Responsive: mobile-first; interactive elements ≥44px touch targets; missing `sm:/md:/lg:` breaks on new full-screen layouts are findings (major).
- Accessibility: semantic `main/header/nav/section/article`, alt text on images, `sr-only` where needed, keyboard-reachable controls.

## API & Network

- **[BLOCKER] Relative API paths only** in frontend code. `fetch('http://localhost:PORT/...')`, absolute URLs, or ports written directly in the URL are violations. Cross-port calls must use the `?XTransformPort=` query form: `fetch('/api/test?XTransformPort=3030')`.
- **[BLOCKER] z-ai-web-dev-sdk is backend-only.** Any import of it in client code (`'use client'` files, components) is a blocker.
- WebSocket/socket.io connections must be `io("/?XTransformPort={port}")` with path `/` — never `io("http://localhost:{port}")`.
- API routes live under `src/app/api/*/route.ts` — use API routes, not server actions, for backend endpoints.

## Runtime & Build

- **[BLOCKER] Port 3000 only** for the Next.js dev server. Any code binding or hardcoding another port for the main app is a violation (mini-services on 3033+ are the exception, they are separate processes).
- Never invoke `next build` in dev flows; lint via `bun run lint`.
- `'use client'` / `'use server'` directives must be first line of the file when used.
- User-visible surface is the `/` route (`src/app/page.tsx`); introducing additional top-level user-facing routes is a finding (major) unless operator requested them.

## Data

- Prisma schema lives in `prisma/schema.prisma`; the SQLite db file lives in `db/`.
- **[BLOCKER]** Prisma schema field types cannot be bare lists (`String[]` etc. forbidden by our setup) — use a relational model or JSON string field.
- State management: Zustand for client state, TanStack Query for server state; ad-hoc global singletons are findings (minor).
- No test files — adding `*.test.ts`/`*.spec.ts` scaffolds is a finding (minor) in this repo.

## Process

- Do not nitpick style/formatting. Findings must cite `file:line`, the problem, why it matters, and a concrete fix.
- Missing loading/error states on new async UI paths is a finding (major): show spinners/skeletons, actionable errors, toasts for feedback.
