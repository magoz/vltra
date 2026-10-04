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
| Page / API routes / actions      | `app/`                                                          | `(fleet)/` one page, `api/fleet`, `*-action.ts`          |
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
| Subscription usage (header)      | `lib/services/usage/`, `lib/data/fleet/usage.ts`                | Reads `~/usage`'s `/api/usage`; one pool per provider    |
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

- One page (`app/(fleet)/page.tsx` → `current-tab.tsx`) with three tabs in `?view=`: **Focus**
  (plain `/`, `agents-focus.tsx`), **Agents** (the board: `?view=agents`, `agents-board.tsx`; old
  `?view=board` links still open it) and **Projects** (`?view=projects`, `projects-grid.tsx`; the old `/projects` redirects in
  `next.config.ts`). Keep it one route: Cache Components keeps up to three visited routes mounted
  in hidden `<Activity>` boundaries (`MAX_BF_CACHE_ENTRIES` in Next's `bfcache-state-manager`), so
  a second route kept a hidden copy of the other page alive (with its own OpenCode iframe) and
  restored its stale state on return. The page is static; the layout's `<Suspense>` holds the live
  client tree (`fleet-live.tsx`: `await connection()`, the watcher's snapshot, then
  `FleetDashboard`), and its fallback, the skeleton (`fleet-dashboard-skeleton.tsx`, Focus' frame
  for every tab, since the prerender cannot see `?view=`), is the prerendered shell. The live tree
  holds the one `GET /api/fleet/events` stream (`use-fleet-live.ts`: reload the snapshot after
  every `initial` event, apply other changes in place, reconnect with backoff and on visibility),
  the clock and Handled's undo state.
- `FleetDashboard` wires server actions, the clock and the URL (`use-fleet-nav.ts`: the tab and
  the filter; `use-selected-session.ts`: `?session=`; `fleet-href.ts` builds every URL) around
  `FleetShell` (`fleet-shell.tsx`): the tabs `Focus | Agents | Projects` (`fleet-header.tsx`), in
  the desktop header (the count line `N need you · N working · N stuck`, centred; on the right the usage
  line, New, `?` and the connection) or the phone's bottom tab bar (`BottomTabs`, with `+`; no header there, only
  `ConnectionLine`: a slim `reconnecting…` line on top once a reconnect lasts 3s, the wait starting
  over when the page shows again), and each tab shows the open session itself (Focus' pane,
  Agents' and Projects' split). Every tab reads `useFleet()` (`fleet-context.tsx`: live fleet with
  overrides, clock, selection, nav). Tab links are `nav-link.tsx` (plain links; a plain click goes through
  `nav.show`).
- Usage line (desktop header, right side, `UsageLine`; under 84rem it leaves, so the centred count line keeps room): the subscription quotas from the `usage` dashboard
  (`~/usage`, `GET /api/usage` on loopback; `lib/services/usage/`, projected by `usage.ts` into
  `GET /api/fleet/usage`, polled by `use-usage.ts` every minute while the page shows):
  `Claude 45% · Codex 96% · Z.AI 100% · Go 34% left`, each the % left of the window that runs
  out first (model-scoped weekly limits excluded; a pool's accounts averaged), red at 10% or less,
  every account's windows and resets on hover. Hidden until it loads; a failed load keeps the last.
- Every move is a history write that Next syncs into `useSearchParams` (no router navigation, no
  fetch, no remount): `nav.show` pushes an entry (Back returns), `setProject` replaces it,
  `openSession` (the launcher) pushes Focus with the session. `moveTo` in `fleet-href.ts` decides
  the filter: given (Projects card headers, and `Enter` on a card, open the board filtered), else
  kept between Focus and Agents; Projects has none, so from it they start unfiltered. `b`
  toggles Focus ↔ Agents; `1` / `2` / `3` pick a tab.
- **Focus** (`agents-focus.tsx`, default): a sidebar (26rem, hairline right border,
  scrolls on its own) with only the needs-me sessions (`buildNeedsMe` / `needsMeOrder` in
  `board.ts`: blocked, longest wait first, then finished, oldest first; the board's Need you
  column is the same list), as compact `AgentCard`s (the board's minimal cards without a box
  of their own) under `Blocked N` / `Finished N` headings, narrowed by the same project filter
  (`project-filter.tsx`). The rest of the page shows the open session (`?session=`, also one not
  in the list, e.g. a working session opened from Projects) inline: the same `SessionPanel` (its
  chat) as the splits, filling the pane (the iframe's absolute fill; no page scroll on desktop).
  Nothing open: "Pick a session on the left", or "Nothing needs you" when the list is empty.
  Handling the open session (the row's or the chat toolbar's button, `h`, swipe; focus mode wraps
  `useHandled` so all go through it) opens the next one in list order (`nextNeedsMe`: the one
  after it, else the one before), or the empty state. The list marks the open session only (tint
  and left edge); `j`/`k` add a cursor (outline) that any change of the open session spends
  (`Cursor.under`), so a session that leaves the list (it works again) leaves nothing marked.
  Phone:
  the list full width; a session opens full screen (the pane becomes `fixed inset-0`), its back
  button returns to the list.
- **Agents**, the board (`?view=agents`, `agents-board.tsx`): columns `Need you | Working |
Handled` (`buildAgentsBoard` in `board.ts`). Need you: blocked (longest wait first, each card
  badged `blocked`), then finished (oldest first). Working: stuck first, then newest session (`created`, so live activity does not reshuffle).
  Handled: active in the last 24h, newest first, then "N more → Projects". Cards
  (`agent-card.tsx`) are minimal: marker (red for a failed run), project · worktree (`boardRow`;
  the global project's sessions by their directory), the `blocked` badge (board only), age and title, flags for `retrying (n×, …)`
  / `quiet Nm` and "folder deleted", Handled (finished) or Reopen (handled, not for "folder
  deleted"). Asks, answers and live activity are left to the chat. `?project=<projectKey>`
  (`other` = the global project) narrows every column: a select (`/` focuses it) and a chip with ×
  (`setProject` replaces the history entry). An open session (`?session=`) splits the board
  (`SessionSplit`): the three columns narrow beside its chat (down to 11rem, then they scroll),
  still clickable to switch it. Phone: one column via a segmented control, opening on Need you
  when it has cards
  (`initialColumn`, else Working), a session full screen; a new filter remounts the board (fresh
  column and focus).
- **Projects**: cards (`buildProjectCards`) by latest activity, "Other" last, 1 / 2 / 3 columns.
  The header links to the board, `/?view=agents&project=<id>`; worktree sections list needs-me and working sessions
  (`ProjectRow`: marker, title, state label, age); handled sessions fold into
  "N handled · last 2h" per card (no time limit), expandable in place, with Reopen. An open session
  splits the page (`SessionSplit`); the grid takes its columns from its own width (`@container`:
  2 from 48rem, 3 from 80rem), so it loses one beside the chat. **Delete** in the header
  (`delete-project.tsx`, `deleteProject` in `actions.ts`) clears out old projects: disabled with
  "N sessions there are working or blocked" while busy; after a confirmation, OpenCode removes
  every session Fleet files under the card (`projectKey`; subagents and archived ones too,
  also with the folder gone) for good, and the card leaves with their `session.deleted`. OpenCode
  has no project delete; files, worktrees and branches are untouched.
- **Launcher** (DESIGN.md "Launcher and worktrees"; `launcher-dialog.tsx`, state in the shell,
  `launcher-context.tsx`): header **New**, `n` and `⌘K`/`Ctrl+K` on any page, the phone tab bar's
  **+** (full screen), and each Projects card's **+** (new-worktree step, repo preselected). The list
  is `GET /api/fleet/launcher` (`use-launcher-list.ts`: on mount, on open, after a launch or a
  retirement, again while PR lookups are still `unknown`, every 5 minutes): repos under
  `FLEET_LAUNCHER_ROOTS` (plus OpenCode's project folders) with their linked worktrees, owner (the
  dotfiles marker, else `pi`; `detached` for OpenCode's own git-strategy checkouts) and PR state,
  most recent agent activity first. Type to fuzzy-filter (`palette.ts`), `↑`/`↓` (`j`/`k` once the
  list has focus) to move. The highlighted row shows its two actions (their own `li role="none"`
  after the option; hovering does not move the highlight, a click/tap does):
  `↵ New session in <repo · branch>` (`newSession`: always a new empty session there, opened in
  focus mode; no open-latest, `openCheckout` is the terminal plugin's) and `⇧↵ New worktree in <repo>…`, which
  switches to a task textarea and a branch field filled by `suggestBranch` 600ms after typing stops ("suggested";
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
  dialogs; keys typed inside the OpenCode iframe stay there): shell `1` / `2` / `3` the tabs, `b`
  Focus ↔ Agents, `n` the launcher (and `⌘K` / `Ctrl+K`, its own listener, also while typing),
  `?` the tab's keys (`shortcuts-dialog.tsx`, `keyHints`; also the header's `?`; no hints line),
  `Escape` closes the session (the palette closes itself). Focus: `j`/`k` (`↓`/`↑`) through
  the list, `Enter` opens the focused session on the right, `h` handled (the cursor's finished
  session, else the open one; the next opens), `u` undo (reopens and opens it), `/` filter; no
  cursor until `j`/`k`, which start from the open session's row. Agents (board): `j`/`k` (`↓`/`↑`) within a
  column, `←`/`→` between columns, `h` handled + next card, `u` undo, `Enter` opens,
  `/` filter; focus starts on the first needs-me card and follows clicks. No key answers asks:
  they are answered in the chat. Projects: arrows between cards (up/down by grid row), `j`/`k`
  within a card (fold rows when open), `Enter` opens the focused session, else the card's board.
- The open session lives in the URL (`?session=<id>`, kept across tabs), next to the tab from
  `lg`: Focus' pane, and on Agents and Projects a split (`SessionSplit` in `session-panel.tsx`: the
  chat docks on the right, `min(52rem, 42vw)`, and the tab narrows beside it, still clickable);
  full screen below `lg`, so the phone's back button closes it (closing goes back only when Fleet
  pushed the entry on this tab).
- The session panel (`session-panel.tsx`, the same on every tab) is the session's chat alone,
  no Summary tab: an iframe of OpenCode's web UI (`row.links.web`), signed in by its same-site
  pairing cookie (`opencode pair`), with full app chrome since upstream has no embed mode. Its
  slim toolbar has only what Fleet adds: the phone's back button, state and title, Handled
  (finished) / Reopen (handled; neither for "folder deleted"), open in the terminal (`ocb://`,
  fine pointers only) or a new tab, close (desktop). Messages, asks, follow-ups and Stop happen in
  the chat. Being same-site, the iframe runs on Fleet's main thread: keep one chat mounted at a
  time (no hidden pages, no pools).
- Mutations go through `FleetActions` (`app/fleet-actions.tsx`): the dashboard provides the server
  actions (the launcher's `launch`, `newSession`, `retireWorktree`, `dismissLaunch` and
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
- Favicon dot (`use-favicon.ts`): brand orange when any session needs you, else amber while any
  works, else green (`app/icon.svg` as is).

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
| `FLEET_USAGE_URL`                   | `http://127.0.0.1:8320`                         | The `usage` dashboard (`~/usage`) for the header's usage line        |
