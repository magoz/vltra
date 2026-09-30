<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# PROJECT KNOWLEDGE BASE

## OVERVIEW

Fleet is one view of every OpenCode session on Box: which need me (permission/form), which are
working, failed or finished unseen, grouped project → worktree. It is an OpenCode **API client**
(never a server plugin), stateless (OpenCode owns all state, including "seen"), private and
single-user (no auth, no database). `DESIGN.md` is the settled spec. Stack and conventions are
10x's (`../10x`): Next.js 16 App Router, React 19, Effect 4, shadcn/ui (Base UI), Tailwind v4.

## WHERE TO LOOK

| Task                        | Location                                 | Notes                                                |
| --------------------------- | ---------------------------------------- | ---------------------------------------------------- |
| Session states / priority   | `lib/data/fleet/state.ts`, `model.ts`    | Pure state machine (`applyEvent`), exhaustive tests  |
| Wire shapes (API, SSE)      | `lib/data/fleet/types.ts`                | Effect Schema; the ocb plugin decodes the same types |
| Snapshot rows / grouping    | `lib/data/fleet/snapshot.ts`, `links.ts` | Roll-up, projects → worktrees → rows, deep links     |
| Watcher, resync, backoff    | `lib/data/fleet/watcher.ts`, `store.ts`  | See `patterns/LONG_LIVED_WATCHER.md`                 |
| Action Effects + inputs     | `lib/data/fleet/actions.ts`              | Mark seen, permission, form, prompt, interrupt       |
| OpenCode client             | `lib/services/opencode/`                 | See `patterns/OPENCODE_SURFACE.md`                   |
| Runtime (one per process)   | `lib/runtime/fleet-runtime.ts`           | `ManagedRuntime` on `globalThis`; `runFleet`         |
| Watcher start               | `instrumentation.ts`                     | Node runtime only; skipped during `next build`       |
| Page / API routes / actions | `app/`                                   | `api/fleet`, `api/fleet/events`, `*-action.ts`       |
| Dashboard UI                | `app/fleet-dashboard.tsx` and siblings   | Client tree seeded by `fleet-live.tsx`; see below    |
| Board (sections, idle 24h)  | `lib/data/fleet/board.ts`                | Pure: live row map, `fleet.changed` apply, grouping  |
| Session panel data          | `lib/data/fleet/session-detail.ts`       | Transcript tail + diff; summaries cached by `idle`   |
| Test doubles                | `lib/**/testing/`                        | Fake OpenCode layer, throwaway `opencode serve`      |
| Conventions                 | `patterns/`, then `../10x/patterns/`     | Fleet notes only where it differs from 10x           |

## CONVENTIONS

- Same as 10x: no `src/`; root `app/`, `components/`, `lib/`; named exports (Next default files
  excepted); kebab-case files; `@/` imports; no barrels; strict TS (no `any`, no casts).
- Data layer (`lib/data/**`) exports Effects and pure functions; only boundaries run them
  (`runFleet` in routes, actions, the page; the runtime in `instrumentation.ts`).
- Parse unknown input at boundaries with Effect Schema; `Schema.TaggedError` for shared errors.
- Everything OpenCode-shaped stops in `lib/services/opencode/mapping.ts`; the rest of Fleet sees
  only its own domain types.
- Browser mutations are server actions (`app/*-action.ts`) with typed inputs, a same-origin
  check (`app/same-origin.ts`), and `FleetActionResult` tagged results. No API routes for them.
- Cache Components: prerendered shell, request-time data behind the smallest `<Suspense>` with
  `await connection()`. Never export `dynamic`/`revalidate`/`fetchCache`/`dynamicParams`.
- Never call `Service.ensure` (it can spawn a server); systemd owns `opencode.service`.
- Code style: no semicolons, single quotes, no trailing commas, 100 columns (oxfmt).
  `DESIGN.md` is excluded from formatting.

## DASHBOARD

- One page (`app/page.tsx`): the prerendered shell is the Suspense fallback
  (`fleet-dashboard-skeleton.tsx`, title + header frame); `fleet-live.tsx` reads the watcher's
  snapshot per request and seeds the client `FleetDashboard`, which stays live from
  `GET /api/fleet/events` (`use-fleet-live.ts`: reload the snapshot after every `initial` event,
  apply other changes in place, reconnect with backoff and on visibility).
- State-first sections (needs you, failed, working, done) then idle, collapsed and grouped
  project → worktree; idle rows are listed for 24h after their last activity (`board.ts`).
- The open session lives in the URL (`?session=<id>`, `use-selected-session.ts`): side panel from
  `lg`, full screen below it, so the phone's back button closes it.
- Mutations go through `FleetActions` (`app/fleet-actions.tsx`): the dashboard provides the server
  actions, component tests provide recording fakes (`app/testing/dashboard-fixtures.tsx`).
- Panel data: `GET /api/fleet/sessions/:id` (transcript tail + latest turn's files, uncached) and,
  for done rows, `GET /api/fleet/sessions/:id/summary?idle=` (answer excerpt + change totals,
  cached in the runtime by `(id, idle)`; see `patterns/LONG_LIVED_WATCHER.md`).
- Look: the approved paper-and-ink mock (`app/globals.css` tokens, mono type, `attention` green
  and `destructive` red only); light/dark follow the system (`prefers-color-scheme`), no toggle.
- PWA: `app/manifest.ts`, `app/icon.svg`, `app/apple-icon.png`, `public/icon-*.png` (no offline).

## TESTS

- `pnpm test` runs two Vitest projects: `unit` (jsdom, colocated `*.test.ts(x)` including
  Testing Library component tests, and the anti-slop/local lint rule suites) and `integration` (`*.integration.test.ts`, node).
- Effect tests use `@effect/vitest`; backoff/timeouts use `TestClock`. Fake services with typed
  layers (`lib/services/opencode/testing/fake-opencode.ts`); `vi.mock` is a lint error.
- The integration suite starts a real, isolated `opencode serve` (v2.0.20) on a random loopback
  port: temp HOME/XDG/TMPDIR/config, rebuilt env (no provider keys), dead outbound proxy, and an
  unavailable model, so it never calls a model or touches `~/.local/share/opencode` or the live
  service. It skips with a message when the binary is missing or not 2.0.20 (`OPENCODE_BIN`).
- Never point any test at the live service (127.0.0.1:49374). Tests must pass `OPENCODE_URL` /
  `OPENCODE_PASSWORD` through the layer config and assert the connection URL.

## COMMANDS

```bash
pnpm dev               # portless run next dev (https://fleet.localhost); set OPENCODE_URL to a throwaway server
pnpm typecheck         # tsc --noEmit
pnpm lint              # oxlint, zero warnings
pnpm format:check      # oxfmt
pnpm test              # unit + integration (vitest)
pnpm build             # next build
pnpm verify            # format + typecheck + lint + test + build
pnpm ship              # build + systemctl --user restart fleet (Box only)
```

## CONFIGURATION

| Variable                            | Default                                 | Purpose                             |
| ----------------------------------- | --------------------------------------- | ----------------------------------- |
| `OPENCODE_URL`, `OPENCODE_PASSWORD` | unset → `Service.discover`              | Explicit endpoint (tests, dev)      |
| `OPENCODE_SERVICE_FILE`             | `$XDG_STATE_HOME/opencode/service.json` | Registration file for discovery     |
| `FLEET_OPENCODE_WEB_URL`            | `https://box.tail129a86.ts.net:9446`    | OpenCode web UI base for deep links |
| `FLEET_SESSION_LIMIT`               | `300`                                   | Newest sessions loaded per snapshot |
