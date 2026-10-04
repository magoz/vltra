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

| Task                             | Location                                                        | Notes                                                    |
| -------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------- |
| Session states / priority        | `lib/data/fleet/state.ts`, `model.ts`                           | blocked > working > finished > handled; stuck, order     |
| Wire shapes (API, SSE)           | `lib/data/fleet/types.ts`                                       | Effect Schema; the ocb plugin decodes the same types     |
| Snapshot rows / grouping         | `lib/data/fleet/snapshot.ts`, `links.ts`                        | Roll-up, projects → worktrees → rows, deep links         |
| Watcher, resync, backoff         | `lib/data/fleet/watcher.ts`, `store.ts`                         | Also interrupt reasons; `LONG_LIVED_WATCHER.md`          |
| Action Effects + inputs          | `lib/data/fleet/actions.ts`                                     | Handled, reopen, viewed (asks: in OpenCode's chat)       |
| Rollout script                   | `scripts/import-handled.ts`                                     | `pnpm fleet:import-handled`, one-off, never auto-run     |
| OpenCode client                  | `lib/services/opencode/`                                        | See `patterns/OPENCODE_SURFACE.md`                       |
| Runtime (one per process)        | `lib/runtime/fleet-runtime.ts`                                  | `ManagedRuntime` on `globalThis`; `runFleet`             |
| Watcher start                    | `instrumentation.ts`                                            | Node runtime only; skipped during `next build`           |
| Pages / API routes / actions     | `app/`                                                          | `(fleet)/` pages, `api/fleet`, `*-action.ts`             |
| Plugin mutation routes (JSON)    | `app/api/fleet/mutations.ts`, `json-request.ts`                 | handled, reopen, launches, dismiss, checkouts/open       |
| Dashboard UI                     | `app/fleet-shell.tsx` and siblings                              | Layout's live tree (`fleet-live.tsx`); see below         |
| Launcher UI                      | `app/launcher-dialog.tsx`, `pending-launches.tsx`               | Palette, launches, `retire-worktree.tsx`                 |
| Agents (focus, board) / Projects | `app/agents-focus.tsx`, `agents-board.tsx`, `projects-grid.tsx` | Cards: `agent-card.tsx`, rows: `session-row.tsx`         |
| Board projections                | `lib/data/fleet/board.ts`                                       | Pure: live rows, needs-me list, columns, cards, filter   |
| Run summaries (plugin page)      | `lib/data/fleet/session-detail.ts`                              | Latest answer + diff totals, cached by `idle`            |
| Launcher list / open / retire    | `lib/data/fleet/launcher.ts`, `checkouts.ts`                    | Pure projection + guards; `GET /api/fleet/launcher`      |
| Launches (worktree + session)    | `lib/data/fleet/launches.ts`                                    | Registry in the runtime, background fibers, in store     |
| Branch names / palette rows      | `lib/data/fleet/branch.ts`, `palette.ts`                        | `--` encoding, suggestion check, fallback, fuzzy         |
| Repos on Box (git, gh)           | `lib/services/repos/`                                           | Roots scan, worktrees + marker owner, cached PR status   |
| Test doubles                     | `lib/**/testing/`                                               | Fake OpenCode / Repos layers, throwaway `opencode serve` |
| Conventions                      | `patterns/`, then `../10x/patterns/`                            | Fleet notes only where it differs from 10x               |

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
- The terminal plugin's mutations are JSON `POST` routes (DESIGN.md "Fleet API"):
  `sessions/:id/handled`, `sessions/:id/reopen`, `launches`, `launches/:id/dismiss`,
  `checkouts/open` under `/api/fleet`. Handlers live in `app/api/fleet/mutations.ts` (route files
  only run them, so tests drive them with fake layers): `readJsonRequest` (same-origin, then JSON
  only, else 415; shared with `launcher/branch`), the actions' Effects and input Schemas, and
  `toMutationResponse` (`200` + result, else `{ error }` with `failureMessage` from
  `fleet-action-result.ts` and `failureStatus`: 400 / 403 / 404 / 409 / 502 / 503). Result
  schemas are in `lib/data/fleet/types.ts`.
- Cache Components: prerendered shell, request-time data behind the smallest `<Suspense>` with
  `await connection()`. Never export `dynamic`/`revalidate`/`fetchCache`/`dynamicParams`.
- Never call `Service.ensure` (it can spawn a server); systemd owns `opencode.service`.
- Code style: no semicolons, single quotes, no trailing commas, 100 columns (oxfmt).
  `DESIGN.md` is excluded from formatting.

## DASHBOARD

- Two pages under one layout (`app/(fleet)/layout.tsx`): **Agents** (`/`, `page.tsx` →
  `agents.tsx`, which picks the mode: `agents-focus.tsx` or `agents-board.tsx`) and **Projects**
  (`/projects` → `projects-grid.tsx`). The pages are static; the layout's `<Suspense>` holds the
  live client tree (`fleet-live.tsx`: `await connection()`, the watcher's snapshot, then
  `FleetDashboard`), and its fallback, the page's skeleton (`fleet-dashboard-skeleton.tsx`, picked
  by `usePathname`; Agents is focus mode's frame, since the prerender cannot see `?view=`), is
  each route's prerendered shell.
  Because the layout survives page switches, both pages share one `GET /api/fleet/events`
  stream (`use-fleet-live.ts`: reload the snapshot after every `initial` event, apply other changes
  in place, reconnect with backoff and on visibility), the clock and Handled's undo state.
- `FleetDashboard` wires server actions, the clock and the URL (`use-fleet-nav.ts`: page from the
  path, `?view=board` Agents mode, `?project=` filter; `use-selected-session.ts`: `?session=`;
  `fleet-href.ts` builds every URL) around `FleetShell` (`fleet-shell.tsx`): header
  (`fleet-header.tsx`: `Agents | Projects` tabs on desktop, the Agents page's `Focus | Board`
  toggle on desktop and phone, count line `N need you · N working · N stuck`, the page's (and
  mode's) key hint, connection), the phone's bottom tab bar, and the session drawer (Projects and
  the board; focus mode shows the session inline). Both pages read `useFleet()`
  (`fleet-context.tsx`: live fleet with overrides, clock, selection, nav). Page links are
  `nav-link.tsx` (`next/link`, prefetched; plain clicks go through `nav.go`).
- **Agents** has two modes (DESIGN.md "Clients" → Web), in the URL: focus is the absence of
  `?view`, the board is `?view=board`. The mode is kept across page switches (like `?session=`),
  so the Agents tab and `1` return to it; the toggle and `b` (`nav.setView`) push a history entry
  and keep `?project=` and `?session=`. Projects card headers (and `Enter` on a card) open the
  board.
- **Agents focus mode** (`agents-focus.tsx`, default): a sidebar (26rem, hairline right border,
  scrolls on its own) with only the needs-me sessions (`buildNeedsMe` / `needsMeOrder` in
  `board.ts`: blocked, longest wait first, then finished, oldest first; the board's two left
  columns are the same lists), as compact `AgentCard`s (the board's minimal cards without a box
  of their own) under `Blocked N` / `Finished N` headings, narrowed by the same project filter
  (`project-filter.tsx`). The rest of the page
  shows the open session (`?session=`, also one not in the list, e.g. a working session opened
  from Projects) inline: the same `SessionPanel` (its chat) as the drawer, filling the pane (the
  iframe's absolute fill; no page scroll on desktop). Nothing open: "Pick a session on the left",
  or "Nothing needs you" when the list is empty. Handling the open session
  (button, `h`, swipe; focus mode wraps `useHandled` so all three go through it) opens the next one
  in list order (`nextNeedsMe`: the one after it, else the one before), or the empty state. Phone:
  the list full width; a session opens full screen (the pane becomes `fixed inset-0`), its back
  button returns to the list.
- **Agents board** (`?view=board`, `agents-board.tsx`): columns `Blocked | Finished | Working |
Handled` (`buildAgentsBoard` in `board.ts`). Blocked: longest wait first. Finished: oldest first.
  Working: stuck first, then newest session (`created`, so live activity does not reshuffle).
  Handled: active in the last 24h, newest first, then "N more → Projects". Cards
  (`agent-card.tsx`) are minimal: marker (red for a failed run), project · worktree (`boardRow`;
  the global project's sessions by their directory), age and title, flags for `retrying (n×, …)`
  / `quiet Nm` and "folder deleted", Handled (finished) or Reopen (handled, not for "folder
  deleted"). Asks, answers and live activity are left to the chat. `?project=<projectKey>` (`other` = the global project) narrows every column:
  a select (`/` focuses it) and a chip with × (`setProject` replaces the history entry). Phone: one
  column via a segmented control, opening on the first non-empty needs-me column
  (`initialColumn`, else Working); a new filter remounts the board (fresh column and focus).
- **Projects**: cards (`buildProjectCards`) by latest activity, "Other" last, 1 / 2 / 3 columns.
  The header links to the board, `/?view=board&project=<id>`; worktree sections list needs-me and working sessions
  (`ProjectRow`: marker, title, state label, age); handled sessions fold into
  "N handled · last 2h" per card (no time limit), expandable in place, with Reopen.
- **Launcher** (DESIGN.md "Launcher and worktrees"; `launcher-dialog.tsx`, state in the shell,
  `launcher-context.tsx`): header **New**, `n` and `⌘K`/`Ctrl+K` on any page, the phone tab bar's
  **+** (full screen), and each Projects card's **+** (new-worktree step, repo preselected). The list
  is `GET /api/fleet/launcher` (`use-launcher-list.ts`: on mount, on open, after a launch or a
  retirement, again while PR lookups are still `unknown`, every 5 minutes): repos under
  `FLEET_LAUNCHER_ROOTS` (plus OpenCode's project folders) with their linked worktrees, owner (the
  dotfiles marker, else `pi`; `detached` for OpenCode's own git-strategy checkouts) and PR state,
  most recent agent activity first. Type to fuzzy-filter (`palette.ts`), `↑`/`↓` (`j`/`k` once the
  list has focus) to move, `Enter` opens the latest root session there, or a new empty one
  (`openCheckout`), in focus mode. The last row, `+ New worktree in <highlighted repo>…`, switches to
  a task textarea and a branch field filled by `suggestBranch` 600ms after typing stops ("suggested";
  editing it stops the suggestions; `⌘↵` creates). Create calls `launch` (returns at once), closes
  the palette and toasts; the launch's session opens when it is ready if the user is still on the
  same page and mode and has not opened anything else meanwhile.
- **Launches** (`live.launches`, from the snapshot and `fleet.changed`): focus mode's sidebar lists
  them as **Provisioning** above Blocked (branch · repo, a ticking elapsed clock, the task; failures
  red with what was kept and ×; ready ones "ready · open session" and ×), the board at the top of
  Working (`pending-launches.tsx`). In memory on the server: lost on restart; ready ones go after 10
  minutes.
- **Projects worktrees**: a card for a launcher repo shows each worktree section under its branch
  with `pi` / `detached`, the PR (`#123 open`, `merged · retire`, `closed · retire`, linked) and,
  for dotfiles-owned worktrees, **Retire** (`retire-worktree.tsx`: disabled with "N sessions there
  are working or blocked" while busy; a confirmation listing what happens; `retireWorktree`, toast).
  The repo's other branch worktrees follow as sections without sessions (`cardSections`).
- Rows order by `activeAt` (run times), never OpenCode's `time.updated`, which handled-marker
  writes bump.
- Handled / Undo / Reopen (`use-handled.tsx`, provided by the shell): applied at once as
  optimistic overrides (until the server's next word on that row, `withOverrides`), Handled
  raises a sonner toast with Undo (= reopen, after the handled write). No "handle all", no drag
  and drop. Phone: swipe a finished card left (`use-swipe.ts`); the Handled button stays.
- Keys (`use-keys.ts`, desktop; ignored while typing (except `Escape`), with modifiers and in
  dialogs; keys typed inside the OpenCode iframe stay there): shell `1` / `2` pages, `b` the other
  Agents mode, `n` the launcher (and `⌘K` / `Ctrl+K`, its own listener, also while typing),
  `Escape` closes the session (drawer or inline; the palette closes itself). Focus: `j`/`k` (`↓`/`↑`) through
  the list, `Enter` opens the focused session on the right, `h` handled (the focused finished
  session, else the open one; the next opens), `u` undo (reopens and opens it), `/` filter;
  focus starts on the open session, else the first row. Board: `j`/`k` (`↓`/`↑`) within a
  column, `←`/`→` between columns, `h` handled + next finished card, `u` undo, `Enter` opens,
  `/` filter; focus starts on the first needs-me card and follows clicks. No key answers asks:
  they are answered in the chat. Projects: arrows between cards (up/down by grid row), `j`/`k`
  within a card (fold rows when open), `Enter` opens the focused session, else the card's board.
- The open session lives in the URL (`?session=<id>`, kept across page switches): inline in focus
  mode, else a right-side drawer (`SessionDrawer`) over the page from `lg`; full screen below it
  either way, so the phone's back button closes it (closing goes back only when Fleet pushed the
  entry on this page and mode).
- The session panel (`session-panel.tsx`) is the session's chat and nothing else: an iframe of
  OpenCode's web UI (`row.links.web`), signed in by its same-site pairing cookie
  (`opencode pair`), with full app chrome since upstream has no embed mode, under one slim
  toolbar (phone back button, state and title, Handled when finished / Reopen when handled, `>_`
  open in the terminal (`ocb://`, fine pointers only), `↗` new tab, ×). Messages, asks,
  follow-ups and Stop happen in the chat.
- Mutations go through `FleetActions` (`app/fleet-actions.tsx`): the dashboard provides the server
  actions (the launcher's `launch`, `openCheckout`, `retireWorktree`, `dismissLaunch` and
  `suggestBranch` return `FleetActionValue`s when they carry a value), component tests provide
  recording fakes (`app/testing/dashboard-fixtures.tsx`:
  `WithFleet` for one card, `TestDashboard` for the whole dashboard with the URL in state, read
  back with `testLocation()`; `fleet-scenario.ts` is the shared fleet).
- Opening a session's panel marks its latest run viewed in OpenCode when it is unread there
  (`viewed` missing or `< idle`; its unread dots only, never Fleet state). The web shows no
  answer excerpts; `GET /api/fleet/sessions/:id/summary?idle=` (answer excerpt + change totals,
  cached in the runtime by `(id, idle)`; see `patterns/LONG_LIVED_WATCHER.md`) serves the
  terminal plugin's page.
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

| Variable                            | Default                                         | Purpose                                                              |
| ----------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------- |
| `OPENCODE_URL`, `OPENCODE_PASSWORD` | unset → `Service.discover`                      | Explicit endpoint (tests, dev)                                       |
| `OPENCODE_SERVICE_FILE`             | `$XDG_STATE_HOME/opencode/service.json`         | Registration file for discovery                                      |
| `FLEET_OPENCODE_WEB_URL`            | `https://box.tail129a86.ts.net:9446`            | OpenCode web UI base for deep links                                  |
| `FLEET_SESSION_LIMIT`               | unset → every session                           | Optional cap on sessions loaded                                      |
| `FLEET_LAUNCHER_ROOTS`              | `~/dev/repos:~/.dotfiles:~/aha:~/collie:~/subs` | Launcher roots (`:` list, `~` ok): each a repo, or a folder of repos |
| `FLEET_BRANCH_MODEL`                | `subs-codex/gpt-5.6-sol`                        | Launcher branch suggestions (`generate.text` model)                  |
