<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# PROJECT KNOWLEDGE BASE

## OVERVIEW

Fleet is one view of every OpenCode session on Box, built around attention: which need me
(blocked on a permission/form, or finished and not yet handled), which are working (and which of
those look stuck), grouped project → worktree. It is an OpenCode **API client** (never a server
plugin), stateless (OpenCode owns all state; Fleet's only state is its handled marker,
`metadata.fleet.handled`, stored on the OpenCode session), private and single-user (no auth, no
database). `DESIGN.md` is the settled spec. Stack and conventions are 10x's (`../10x`): Next.js 16
App Router, React 19, Effect 4, shadcn/ui (Base UI), Tailwind v4.

## WHERE TO LOOK

| Task                         | Location                                    | Notes                                                |
| ---------------------------- | ------------------------------------------- | ---------------------------------------------------- |
| Session states / priority    | `lib/data/fleet/state.ts`, `model.ts`       | blocked > working > finished > handled; stuck, order |
| Wire shapes (API, SSE)       | `lib/data/fleet/types.ts`                   | Effect Schema; the ocb plugin decodes the same types |
| Snapshot rows / grouping     | `lib/data/fleet/snapshot.ts`, `links.ts`    | Roll-up, projects → worktrees → rows, deep links     |
| Watcher, resync, backoff     | `lib/data/fleet/watcher.ts`, `store.ts`     | Also interrupt reasons; `LONG_LIVED_WATCHER.md`      |
| Action Effects + inputs      | `lib/data/fleet/actions.ts`                 | Handled, reopen, viewed, answers, prompt, interrupt  |
| Rollout script               | `scripts/import-handled.ts`                 | `pnpm fleet:import-handled`, one-off, never auto-run |
| OpenCode client              | `lib/services/opencode/`                    | See `patterns/OPENCODE_SURFACE.md`                   |
| Runtime (one per process)    | `lib/runtime/fleet-runtime.ts`              | `ManagedRuntime` on `globalThis`; `runFleet`         |
| Watcher start                | `instrumentation.ts`                        | Node runtime only; skipped during `next build`       |
| Pages / API routes / actions | `app/`                                      | `(fleet)/` pages, `api/fleet`, `*-action.ts`         |
| Dashboard UI                 | `app/fleet-shell.tsx` and siblings          | Layout's live tree (`fleet-live.tsx`); see below     |
| Agents board / Projects grid | `app/agents-board.tsx`, `projects-grid.tsx` | Cards: `agent-card.tsx`, rows: `session-row.tsx`     |
| Board projections            | `lib/data/fleet/board.ts`                   | Pure: live rows, columns, 24h window, cards, filter  |
| Session panel data           | `lib/data/fleet/session-detail.ts`          | Transcript tail + diff; summaries cached by `idle`   |
| Test doubles                 | `lib/**/testing/`                           | Fake OpenCode layer, throwaway `opencode serve`      |
| Conventions                  | `patterns/`, then `../10x/patterns/`        | Fleet notes only where it differs from 10x           |

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

- Two pages under one layout (`app/(fleet)/layout.tsx`): **Agents** (`/`, `page.tsx` →
  `agents-board.tsx`) and **Projects** (`/projects` → `projects-grid.tsx`). The pages are static;
  the layout's `<Suspense>` holds the live client tree (`fleet-live.tsx`: `await connection()`,
  the watcher's snapshot, then `FleetDashboard`), and its fallback, the page's skeleton
  (`fleet-dashboard-skeleton.tsx`, picked by `usePathname`), is each route's prerendered shell.
  Because the layout survives page switches, both pages share one `GET /api/fleet/events`
  stream (`use-fleet-live.ts`: reload the snapshot after every `initial` event, apply other changes
  in place, reconnect with backoff and on visibility), the clock and Handled's undo state.
- `FleetDashboard` wires server actions, the clock and the URL (`use-fleet-nav.ts`: page from the
  path, `?project=` filter; `use-selected-session.ts`: `?session=`; `fleet-href.ts` builds every
  URL) around `FleetShell` (`fleet-shell.tsx`): header (`fleet-header.tsx`: `Agents | Projects`
  tabs on desktop, count line `N need you · N working · N stuck`, the page's key hint, connection),
  the phone's bottom tab bar, and the session drawer. Both pages read `useFleet()`
  (`fleet-context.tsx`: live fleet with overrides, clock, selection, nav). Page links are
  `nav-link.tsx` (`next/link`, prefetched; plain clicks go through `nav.go`).
- **Agents** (DESIGN.md "Clients" → Web): columns `Blocked | Finished | Working | Handled`
  (`buildAgentsBoard` in `board.ts`). Blocked: longest wait first, inline answers incl.
  `subagent <agent> asks:`. Finished: oldest first, answer excerpt, change totals, failed /
  "stopped by OpenCode" labels, Handled. Working: stuck first, then newest session (`created`, so
  live activity does not reshuffle), activity and `retrying (n×, …)` / `quiet Nm`. Handled: active
  in the last 24h, newest first, Reopen (not for "folder deleted"), then "N more → Projects".
  Cards (`agent-card.tsx`) show project · worktree (`boardRow`; the global project's sessions by
  their directory). `?project=<projectKey>` (`other` = the global project) narrows every column:
  a select (`/` focuses it) and a chip with × (`setProject` replaces the history entry). Phone: one
  column via a segmented control, opening on the first non-empty needs-me column
  (`initialColumn`, else Working); a new filter remounts the board (fresh column and focus).
- **Projects**: cards (`buildProjectCards`) by latest activity, "Other" last, 1 / 2 / 3 columns.
  The header links to `/?project=<id>`; worktree sections list needs-me and working sessions
  (`ProjectRow`: marker, title, state label, age); handled sessions fold into
  "N handled · last 2h" per card (no time limit), expandable in place, with Reopen.
- Rows order by `activeAt` (run times), never OpenCode's `time.updated`, which handled-marker
  writes bump.
- Handled / Undo / Reopen (`use-handled.tsx`, provided by the shell): applied at once as
  optimistic overrides (until the server's next word on that row, `withOverrides`), Handled
  raises a sonner toast with Undo (= reopen, after the handled write). No "handle all", no drag
  and drop. Phone: swipe a finished card left (`use-swipe.ts`); the Handled button stays.
- Keys (`use-keys.ts`, desktop; ignored while typing (except `Escape`), with modifiers and in
  dialogs): shell `1` / `2` pages, `Escape` closes the drawer. Agents: `j`/`k` (`↓`/`↑`) within a
  column, `←`/`→` between columns, `h` handled + next finished card, `u` undo, `a`/`d` allow once
  / deny the focused card's first permission, `Enter` opens, `/` filter; focus starts on the first
  needs-me card and follows clicks. Projects: arrows between cards (up/down by grid row), `j`/`k`
  within a card (fold rows when open), `Enter` opens the focused session, else the card's board.
- The open session lives in the URL (`?session=<id>`, kept across page switches): a right-side
  drawer over either page from `lg`, full screen below it, so the phone's back button closes it
  (closing goes back only when Fleet pushed the entry on this page).
- Drawer tabs Summary | Chat (`c` toggles; last choice in `localStorage`, `use-drawer-tab.ts`):
  Chat is an iframe of OpenCode's web UI (`row.links.web`), signed in by its same-site pairing
  cookie (`opencode pair`), with full app chrome since upstream has no embed mode.
- Mutations go through `FleetActions` (`app/fleet-actions.tsx`): the dashboard provides the server
  actions, component tests provide recording fakes (`app/testing/dashboard-fixtures.tsx`:
  `WithFleet` for one card, `TestDashboard` for the whole dashboard with the URL in state;
  `fleet-scenario.ts` is the shared fleet).
- Panel data: `GET /api/fleet/sessions/:id` (transcript tail + latest turn's files, uncached) and,
  for finished cards, `GET /api/fleet/sessions/:id/summary?idle=` (answer excerpt + change
  totals, cached in the runtime by `(id, idle)`; see `patterns/LONG_LIVED_WATCHER.md`). Opening
  the drawer marks the latest run viewed in OpenCode when it is unread there (`viewed` missing or
  `< idle`; its unread dots only, never Fleet state). The drawer offers Handled (finished), Reopen
  (handled), Interrupt (running) and the subagent tree with each child's state.
- Look: the approved paper-and-ink mock (`app/globals.css` tokens, mono type, `attention` green
  and `destructive` red only, hairline borders, no shadows); light/dark follow the system
  (`prefers-color-scheme`), no toggle.
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
pnpm fleet:import-handled [--dry-run]  # one-off rollout: viewed root runs → handled (never auto-run)
```

## CONFIGURATION

| Variable                            | Default                                 | Purpose                             |
| ----------------------------------- | --------------------------------------- | ----------------------------------- |
| `OPENCODE_URL`, `OPENCODE_PASSWORD` | unset → `Service.discover`              | Explicit endpoint (tests, dev)      |
| `OPENCODE_SERVICE_FILE`             | `$XDG_STATE_HOME/opencode/service.json` | Registration file for discovery     |
| `FLEET_OPENCODE_WEB_URL`            | `https://box.tail129a86.ts.net:9446`    | OpenCode web UI base for deep links |
| `FLEET_SESSION_LIMIT`               | unset → every session                   | Optional cap on sessions loaded     |
