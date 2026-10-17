<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# PROJECT KNOWLEDGE BASE

## OVERVIEW

Vltra is one view of every OpenCode session on one host, built around attention: which need me
(blocked on a permission/form, or finished and not yet handled), which are working (and which of
those look stuck), grouped project → worktree. It is an OpenCode **API client** (never a server
plugin), stateless (OpenCode owns all state; Vltra's only state is its handled marker,
`metadata.vltra.handled`, stored on the OpenCode session, plus its Web Push file: keys and
subscribed devices, never session state), private and single-user (no auth, no database: a
private network is the boundary). The legacy `metadata.fleet.handled` (from before the rename) is
read, never written. `DESIGN.md` is the settled spec. Stack: Next.js 16 App Router, React 19,
Effect 4, shadcn/ui (Base UI), Tailwind v4.

## WHERE TO LOOK

| Task                             | Location                                                         | Notes                                                     |
| -------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------- |
| Session states / priority        | `lib/data/vltra/state.ts`, `model.ts`                            | blocked > working > finished > handled; stuck, order      |
| Wire shapes (API, SSE)           | `lib/data/vltra/types.ts`                                        | Effect Schema; the ocb plugin decodes the same types      |
| Snapshot rows / grouping         | `lib/data/vltra/snapshot.ts`, `links.ts`                         | Roll-up, projects → worktrees → rows, deep links          |
| Watcher, resync, backoff         | `lib/data/vltra/watcher.ts`, `store.ts`                          | Also interrupt reasons; `LONG_LIVED_WATCHER.md`           |
| Action Effects + inputs          | `lib/data/vltra/actions.ts`                                      | Handled, reopen, viewed (asks: in OpenCode's chat)        |
| Rollout script                   | `scripts/import-handled.ts`                                      | `pnpm vltra:import-handled`, one-off, never auto-run      |
| OpenCode client                  | `lib/services/opencode/`                                         | See `patterns/OPENCODE_SURFACE.md`                        |
| Chat proxy, chat keys            | `proxy.ts`, `app/opencode-proxy.ts`, `app/chat-keys.ts`          | Same-origin OpenCode iframe; Vltra's keys inside it       |
| Chat tab strip cleanup           | `app/chat-tabs.ts`                                               | Done sessions leave OpenCode's tabs (its own event)       |
| Runtime (one per process)        | `lib/runtime/vltra-runtime.ts`                                   | `ManagedRuntime` on `globalThis`; `runVltra`              |
| Watcher start                    | `instrumentation.ts`                                             | Node runtime only; skipped during `next build`            |
| Shutdown (SIGTERM deadline)      | `lib/runtime/shutdown.ts`                                        | Exits 3s after the signal; `LONG_LIVED_WATCHER.md`        |
| Page / API routes / actions      | `app/`                                                           | `(vltra)/` one page, `api/vltra`, `*-action.ts`           |
| Plugin mutation routes (JSON)    | `app/api/vltra/mutations.ts`, `json-request.ts`                  | handled, reopen, launches, dismiss, checkouts/open        |
| Dashboard UI                     | `app/vltra-shell.tsx` and siblings                               | Layout's live tree (`vltra-live.tsx`); see below          |
| Launcher UI                      | `app/launcher-dialog.tsx`, `pending-launches.tsx`                | Palette, launches, `retire-worktree.tsx`                  |
| Agents (focus, board) / Projects | `app/agents-focus.tsx`, `agents-board.tsx`, `projects-grid.tsx`  | Cards: `agent-card.tsx`, rows: `session-row.tsx`          |
| Board projections                | `lib/data/vltra/board.ts`                                        | Pure: live rows, needs-me list, columns, cards, filter    |
| Run summaries (plugin page)      | `lib/data/vltra/session-detail.ts`                               | Latest answer + diff totals, cached by `idle`             |
| Stats tab (data)                 | `lib/data/vltra/stats.ts`, `stats-period.ts`, `stats-view.ts`    | OpenCode `session.stats` per range + bucket; projections  |
| Stats tab (UI)                   | `app/stats-page.tsx`, `stats-charts.tsx`, `use-stats.ts`         | Recharts (lazy), `components/ui/chart.tsx`                |
| Stats frames, heatmaps, skeleton | `app/stats-card.tsx`, `stats-heatmaps.tsx`, `stats-skeleton.tsx` | No Recharts: the skeleton shows while the tab loads       |
| Notifications (what, when)       | `lib/data/vltra/notify.ts`, `notifier.ts`                        | Pure snapshot diff + grace recheck; forked in runtime     |
| Web Push (keys, devices, send)   | `lib/services/push/`, `lib/data/vltra/push.ts`                   | `push.json` (0600), `web-push`; fake in `testing/`        |
| Settings tab, service worker     | `app/settings-page.tsx`, `use-push.ts`, `public/sw.js`           | Turn on/off, test, devices; DESIGN.md "Notifications"     |
| Launcher list / open / retire    | `lib/data/vltra/launcher.ts`, `checkouts.ts`                     | Pure projection + guards; `GET /api/vltra/launcher`       |
| Launches (worktree + session)    | `lib/data/vltra/launches.ts`, `lib/services/watcher/`            | Registry in store; Watcher runs them (backend), see below |
| Branch names / palette rows      | `lib/data/vltra/branch.ts`, `palette.ts`                         | `--` encoding, suggestion check, fallback, fuzzy          |
| Repos on the host (git, gh)      | `lib/services/repos/`                                            | Roots scan, worktrees + marker owner, cached PR status    |
| Subscription usage (header)      | `lib/services/usage/`, `lib/data/vltra/usage.ts`                 | Reads `usage`'s `/api/usage`; one pool per provider       |
| Test doubles                     | `lib/**/testing/`                                                | Fake OpenCode / Repos layers, throwaway `opencode serve`  |
| Conventions                      | `patterns/`                                                      | Effect, TypeScript, testing, long-lived watcher, OpenCode |

## CONVENTIONS

- No `src/`; root `app/`, `components/`, `lib/`; named exports (Next default files
  excepted); kebab-case files; `@/` imports; no barrels; strict TS (no `any`, no casts).
- Data layer (`lib/data/**`) exports Effects and pure functions; only boundaries run them
  (`runVltra` in routes, actions, the page; the runtime in `instrumentation.ts`).
- Parse unknown input at boundaries with Effect Schema; `Schema.TaggedError` for shared errors.
- Everything OpenCode-shaped stops in `lib/services/opencode/mapping.ts`; the rest of Vltra sees
  only its own domain types.
- Browser mutations are server actions (`app/*-action.ts`) with typed inputs, a same-origin
  check (`app/same-origin.ts`), and `VltraActionResult` tagged results. No API routes for them.
- The terminal plugin's mutations are JSON `POST` routes (DESIGN.md "Vltra API"):
  `sessions/:id/handled`, `sessions/:id/reopen`, `launches`, `launches/:id/dismiss`,
  `checkouts/open` under `/api/vltra`. Handlers live in `app/api/vltra/mutations.ts` (route files
  only run them, so tests drive them with fake layers): `readJsonRequest` (same-origin, then JSON
  only, else 415; shared with `launcher/branch`), the actions' Effects and input Schemas, and
  `toMutationResponse` (`200` + result, else `{ error }` with `failureMessage` from
  `vltra-action-result.ts` and `failureStatus`: 400 / 403 / 404 / 409 / 502 / 503). Result
  schemas are in `lib/data/vltra/types.ts`.
- Cache Components: prerendered shell, request-time data behind the smallest `<Suspense>` with
  `await connection()`. Never export `dynamic`/`revalidate`/`fetchCache`/`dynamicParams`.
- Never call `Service.ensure` (it can spawn a server); the host's service manager owns OpenCode.
- Code style: no semicolons, single quotes, no trailing commas, 100 columns (oxfmt).
  `DESIGN.md` is excluded from formatting.

## DASHBOARD

- One page (`app/(vltra)/page.tsx` → `current-tab.tsx`) with five tabs in `?view=`: **Focus**
  (plain `/`, `agents-focus.tsx`), **Agents** (the board: `?view=agents`, `agents-board.tsx`; old
  `?view=board` links still open it), **Projects** (`?view=projects`, `projects-grid.tsx`; the old `/projects` redirects in
  `next.config.ts`), **Stats** (`?view=stats`, `stats-page.tsx`, loaded with `next/dynamic`) and **Settings** (`?view=settings`, `settings-page.tsx`). Keep it one route: Cache Components keeps up to three visited routes mounted
  in hidden `<Activity>` boundaries (`MAX_BF_CACHE_ENTRIES` in Next's `bfcache-state-manager`), so
  a second route kept a hidden copy of the other page alive (with its own OpenCode iframe) and
  restored its stale state on return. The page is static; the layout's `<Suspense>` holds the live
  client tree (`vltra-live.tsx`: `await connection()`, the watcher's snapshot, then
  `VltraDashboard`), and its fallback, the skeleton (`vltra-dashboard-skeleton.tsx`, Focus' frame
  for every tab, since the prerender cannot see `?view=`), is the prerendered shell. The live tree
  holds the one `GET /api/vltra/events` stream (`use-vltra-live.ts`: reload the snapshot after
  every `initial` event, apply other changes in place, reconnect with backoff and on visibility),
  the clock and Handled's undo state.
- `VltraDashboard` wires server actions, the clock and the URL (`use-vltra-nav.ts`: the tab and
  the filter, Stats' range; `use-selected-session.ts`: `?session=`; `vltra-href.ts` builds every
  URL) around `VltraShell` (`vltra-shell.tsx`): the tabs `Focus | Agents | Projects | Stats | Settings`
  (`vltra-header.tsx`; on the phone Settings is a `⚙`), in
  the desktop header (the `vltra` wordmark first, `components/brand/logo.tsx`, as the title, in
  ink; then the tabs; the count line `N need you · N working · N stuck`, centred; on the right the usage
  line, New, `?` and the connection) or the phone's bottom tab bar (`BottomTabs`, with `+`; no header there, only
  `ConnectionLine`: a slim `reconnecting…` line on top once a reconnect lasts 3s, the wait starting
  over when the page shows again), and each tab shows the open session itself (Focus' pane,
  Agents' and Projects' split). Every tab reads `useVltra()` (`vltra-context.tsx`: live vltra with
  overrides, clock, selection, nav). Tab links are `nav-link.tsx` (plain links; a plain click goes through
  `nav.show`).
- Usage line (desktop header, right side, `UsageLine`; under 84rem it leaves, so the centred count line keeps room): the subscription quotas from the `usage` dashboard
  ([magoz/usage](https://github.com/magoz/usage), `GET /api/usage` on loopback; `lib/services/usage/`, projected by `usage.ts` into
  `GET /api/vltra/usage`, polled by `use-usage.ts` every minute while the page shows):
  `Claude 106% 2d · Codex 184% 4d · Go 32% 5d`, each the % left of the longest window
  (weekly, Go's monthly, as `usage` shows it; model-scoped weekly limits excluded; a pool's accounts summed, 100% each), red at 10% of the pool or less,
  then the time to that window's first reset; hovering a pool shows its accounts' windows as `usage`-style bars (`UsagePoolDetail`, in `components/ui/tooltip.tsx`), the account the proxy routes to first, marked `active` (`usage`'s `routing`, from the proxy's sticky-fill-first pins; none when unknown). Hidden until it loads; a failed load keeps the last.
- Every move is a history write that Next syncs into `useSearchParams` (no router navigation, no
  fetch, no remount): `nav.show` pushes an entry (Back returns), `setProject` replaces it,
  `openSession` (the launcher) pushes Focus with the session. `moveTo` in `vltra-href.ts` decides
  the filter: given (Projects card headers, and `Enter` on a card, open the board filtered), else
  kept between Focus (which ignores it), Agents and Stats; Projects and Settings have none
  (`hasFilter`), so from them they start unfiltered. Stats' range (`?range=` / `?from=&to=`) lives
  only on Stats. `1`–`5` pick a tab.
- **Focus** (`agents-focus.tsx`, default): a sidebar (26rem, hairline right border,
  scrolls on its own) with only the needs-me sessions (`buildNeedsMe` / `needsMeOrder` in
  `board.ts`: blocked, then finished, each newest first; the board's Need you
  column is the same list), as compact `AgentCard`s (the board's minimal cards without a box
  of their own) in one list: no headings and no project filter (it ignores Agents' `?project=`,
  which stays in the URL for the way back); blocked rows carry the `blocked` badge. The rest of the page shows the open session (`?session=`, also one not
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
Done` (`buildAgentsBoard` in `board.ts`). Need you: blocked (newest wait first, each card
  badged `blocked`), then finished (newest first). Working: stuck first, then newest session (`created`, so live activity does not reshuffle).
  Done (handled): active in the last 24h, newest first, then "N more → Projects". Cards
  (`agent-card.tsx`) are minimal: marker (red for a failed run), the project (`boardRow`; the
  global project's sessions by their directory), the `blocked` badge, `✔ Done` left of the age
  (finished; with a mouse only on hover, the project name giving way; on touch always, but not
  in Focus' list), age,
  title, then for worktree sessions a line with the worktree (`worktreeLabel`: its folder minus
  the repo's `<name>-` prefix) left and its PR plus the issues it closes right, linked
  (`worktreeAt` in the launcher list; none before it loads or for the primary checkout), flags for
  `retrying (n×, …)` / `quiet Nm` and "folder deleted", Reopen (handled, not for "folder
  deleted"). Asks, answers and live activity are left to the chat. `?project=<projectKey>`
  (`other` = the global project) narrows every column: a searchable select (`project-filter.tsx`,
  `components/ui/combobox.tsx`, Base UI Combobox; `/` opens it on its search) and a chip with ×
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
  every session Vltra files under the card (`projectKey`; subagents and archived ones too,
  also with the folder gone) for good, and the card leaves with their `session.deleted`. OpenCode
  has no project delete; files, worktrees and branches are untouched.
- **Stats** (`?view=stats`, `stats-page.tsx`): charts of OpenCode's own data, no Vltra state.
  Range: presets `24h · 7d · 30d · 90d · All` (default 7d, no param; `[` / `]` step) or Custom
  days (`?from=&to=`, `stats-period.ts`); project filter shared with Agents (`?project=`, mapped
  to OpenCode's project id, `other` → `global`). `GET /api/vltra/stats` (`stats.ts`) reads
  `session.stats` for the range (tools in detail), the as long range before (tiles' change) and
  per bucket (hours ≤ 48h, days ≤ 92, else weeks from Monday, in the browser's zone); buckets
  settled 10 min are cached in the runtime (`Stats` service). Two more reads load apart so the
  page never waits: `/api/vltra/stats/projects` (prompts by project: one `tools: none` call per
  OpenCode project to rank them, then the top three's bars) and `/hours` (prompts per hour, up
  to 31 days, else `TooLong`). `use-stats.ts`
  refetches each every minute while shown, keeping the last value. Top to bottom: 7 tiles (Done, prompts, steps, tool calls, tokens,
  cache reads, active days; Done: sessions done in the range with the subagents count under it; each with sparkline, its bar's
  date and value on hover, and change, `24×` past doubling), then cards in a grid by the page's width (1 column,
  2 from 56rem, 3 from 80rem; the tools table takes 2 of 3): Done (root sessions marked
  done by project, the same projects as below, by their latest run's end, the `handled` marker's own time; when Done was pressed is not
  recorded), sessions started and prompts (both by the same top three
  projects, so each keeps one ink), the year calendar (sessions done per day from the live vltra, whatever the
  range, `doneByDay` / `yearWeeks`; in a card under 36rem the last 26 weeks),
  time of day (weekday × hour heatmap, hour bars; sessions started past 31
  days), steps and steps per prompt, tokens by model and model share, tool calls and failure
  rate, cache hits and run outcomes over time, session length and subagents per session (bins),
  tokens × length (a dot per session, log scales), then the models, tools and outcomes tables.
  Pure projections in `stats-view.ts`; session-based charts (started, outcomes, lengths,
  subagents, scatter) read the live vltra, rows carrying `tokens` (fresh tokens, no cache reads).
  The skeleton (`stats-skeleton.tsx`, also the lazy chunk's `loading`) draws the same tiles and
  cards (`skeletonCards`, held to the page's order by a test) at their sizes, the heatmaps empty.
  Stacks keep three series and "rest" (more grey shades are hard to tell apart); heatmaps use
  five even ink steps (`inkLevel`) and hover tips (`HeatTips`: cells' `data-tip`). No cost: OpenCode prices subscription models at $0.
- **Launcher** (DESIGN.md "Launcher and worktrees"; `launcher-dialog.tsx`, state in the shell,
  `launcher-context.tsx`): header **New**, `n` and `⌘K`/`Ctrl+K` on any page (in the chat too;
  OpenCode's palette stays on `⌘P` / `⌘⇧P`, which on a session page is the same dialog as its
  `⌘K`), the phone tab bar's
  **+** (full screen), and each Projects card's **+** (new-worktree step, repo preselected). The list
  is `GET /api/vltra/launcher` (`use-launcher-list.ts`: on mount, on open, after a launch or a
  retirement, again while PR lookups are still `unknown`, every 5 minutes): repos under
  `VLTRA_LAUNCHER_ROOTS` (plus OpenCode's project folders) with their linked worktrees, owner (the
  dotfiles marker, else `pi`; `detached` for OpenCode's own git-strategy checkouts) and PR state,
  plus roots that are plain folders (no git, no repos in them, e.g. a scratch folder: `Repos.folders`,
  entries of `kind: 'folder'`, marked `folder`, new session only, no `⇧↵`; `newSession` accepts
  them), most recent agent activity first. Type to fuzzy-filter (`palette.ts`), `↑`/`↓` (`j`/`k` once the
  list has focus) to move. The bar under the list (`ActionBar`) shows the highlighted row's two
  actions as buttons, then `↑ ↓ move · esc close` (hovering does not move the highlight, a
  click/tap does):
  `↵ New session in <repo · branch>` (`newSession`: always a new empty session there, opened in
  focus mode; no open-latest, `openCheckout` is the terminal plugin's) and `⇧↵ New worktree in <repo>…`, which
  switches to a task textarea and a branch field filled by `suggestBranch` 600ms after typing stops ("suggested";
  editing it stops the suggestions; `↵` creates, `⇧↵` is a new line in the task; Create before a
  suggestion asks for it at once and launches with it). Create calls `launch` (returns at once), closes
  the palette and toasts; the launch's session opens when it is ready if the user is still on the
  same page and mode and has not opened anything else meanwhile.
- **Launches** (`live.launches`, from the snapshot and `vltra.changed`) show only while they have
  no session of their own (`pendingLaunches` in `board.ts`): setting up, or failed. Once ready, a
  launch is just its session, listed like any other (working, so on the board, not in focus mode's
  list). Cards shaped like `AgentCard` (`pending-launches.tsx`: pulsing dashed marker,
  repo · branch, a ticking clock, the task as title, `provisioning…` / `starting the session…`;
  failures red with what was kept and ×): focus mode's **Provisioning** above its list (compact),
  the board at the top of Working. The registry is in memory. Backends in `launches.ts`
  (`VLTRA_LAUNCHER`): `opencode` (default, in-process; a Vltra restart cuts a running
  `worktree.create`, which OpenCode cancels with its client) and `watcher`: the launches run in a
  **Watcher** daemon (`POST /launches` on its unix socket, watch id `manual`, no guardrails), so a
  Vltra restart (`pnpm ship`) does not cut them. Vltra follows each run (`GET /runs/:id`, every
  second, through Watcher's own restarts) and, at boot, lists and follows the ones still running.
  Watcher down: launching fails with "Watcher is not running" (503). `pnpm dev` against a
  throwaway server never sets `watcher`, so it never launches through a live Watcher.
  Ready ones stay in the registry 10 minutes (the page's auto-open, the plugin) but no longer show
  on the web.
- **Projects worktrees**: a card for a launcher repo shows each worktree section under its branch
  with `pi` / `detached`, the PR (`#123 open`, `merged · retire`, `closed · retire`, then `· closes #98` from
  GitHub's closing references, same `gh pr list` call; linked) and,
  for dotfiles-owned worktrees, **Retire** (`retire-worktree.tsx`: disabled with "N sessions there
  are working or blocked" while busy; a confirmation listing what happens; `retireWorktree`, toast).
  The repo's other branch worktrees follow as sections without sessions (`cardSections`).
- Rows order by `activeAt` (run times), never OpenCode's `time.updated`, which handled-marker
  writes bump.
- The web says **Done** for handled: the outlined `✔ Done` button (`handled-button.tsx`, "Mark done
  (h)"), the board's Done column, the "Done" toast, "N done · last 2h" in Projects, the `done`
  state label. Code, the stored marker (`metadata.vltra.handled`), the API and the plugin keep
  "handled".
- Handled / Undo / Reopen (`use-handled.tsx`, provided by the shell): applied at once as
  optimistic overrides (until the server's next word on that row, `withOverrides`), Handled
  raises a sonner toast with Undo (= reopen, after the handled write). No "handle all", no drag
  and drop. Phone: swipe a finished card left (`use-swipe.ts`); the board's cards keep the `✔ Done`
  button, Focus' list rows do not (swipe only).
- Keys (`use-keys.ts`, desktop; ignored while typing (except `Escape`), with modifiers and in
  dialogs; in the chat, `chat-keys.ts` hands Vltra the keys the chat does not own, see the
  session panel): shell `1`–`5` the tabs, `n` the launcher (and `⌘K` / `Ctrl+K`,
  `isLauncherKey`, its own listener, also while typing),
  `?` / `⌘/` (`isHelpKey`, also while typing) the tab's keys (`shortcuts-dialog.tsx`,
  `keyHints`; also the header's `?`; no hints line),
  `Escape` closes the session (the palette closes itself). `⌘1`–`⌘9` open Focus' Nth session
  (in Focus from another tab) and `⌘⌥1`–`⌘⌥5` pick a tab, `⌘U` is the tab's `u` (`useKeys`),
  `⌘I` / `i` put the caret in the chat's composer (`useInsertKeys`; `chat-composer.ts`, which also
  focuses it once when a chat loads, on a fine pointer, unless a Vltra field or dialog has focus),
  `⌘D` marks the open finished session done (`useDoneKey` in
  `session-panel.tsx`, through `markHandled`, so Focus opens the next) (`command-keys.ts`, read by
  `code`; `useCommandKeys` in the shell, from anywhere but dialogs, in the chat even while typing;
  always `preventDefault`, so the browser does not switch tabs). Focus: `j`/`k` (`↓`/`↑`) through
  the list, `Enter` opens the focused session on the right, `h` handled (the cursor's finished
  session, else the open one; the next opens), `u` undo (reopens and opens it); no
  cursor until `j`/`k`, which start from the open session's row. Agents (board): `j`/`k` (`↓`/`↑`) within a
  column, `←`/`→` between columns, `h` handled + next card, `u` undo, `Enter` opens,
  `/` filter; focus starts on the first needs-me card and follows clicks. No key answers asks:
  they are answered in the chat. Projects: arrows between cards (up/down by grid row), `j`/`k`
  within a card (fold rows when open), `Enter` opens the focused session, else the card's board.
- The open session lives in the URL (`?session=<id>`, kept across tabs), next to the tab from
  `lg`: Focus' pane, and on Agents and Projects a split (`SessionSplit` in `session-panel.tsx`: the
  chat docks on the right, `min(52rem, 42vw)`, and the tab narrows beside it, still clickable);
  full screen below `lg`, so the phone's back button closes it (closing goes back only when Vltra
  pushed the entry on this tab).
- The session panel (`session-panel.tsx`, the same on every tab) is the session's chat alone,
  no Summary tab: an iframe of OpenCode's web UI (`row.links.web`), with full app chrome since
  upstream has no embed mode. Vltra serves OpenCode's web UI and API from its own origin
  (`proxy.ts`: OpenCode's root paths, `/api/*` but `/api/vltra/*`, to the loopback service;
  `/sw.js` stays out; `opencode-proxy.ts` gives same-origin requests the target's `Origin` so
  OpenCode honours its cookie; Next buffers every proxied body, silently cut at
  `proxyClientMaxBodySize`, `1gb` in `next.config.ts` for pasted images and files), so the chat
  is same-origin, signed in by OpenCode's pairing cookie
  (`opencode pair --url <VLTRA_OPENCODE_WEB_URL>`, once per browser). Same-origin lets Vltra take the
  chat's keys (`useChatFrame` / `forwardChatKeys` in `chat-keys.ts`: a capture listener on the
  frame's window replays each key on Vltra's document unless the chat owns it: typing, its
  overlays, scroll keys, `Enter` on a control; `⌘K`, `⌘/` and the `⌘` chords are always Vltra's,
  `⌘P` OpenCode's; `Escape` goes to the chat
  first and an unused one moves focus to Vltra, where the next closes the session). Every
  session opened leaves a tab in OpenCode's own tab strip (browser localStorage; its server knows
  nothing of tabs), so done sessions leave it (`useCloseDoneTabs` in `chat-tabs.ts`): once the chat
  loads and whenever the done set changes, Vltra sends OpenCode's internal
  `opencode:session-tabs-removed` event into the frame (made in the frame's realm: OpenCode checks
  `instanceof CustomEvent`), all done sessions but the open one; it reads the saved strip back,
  resends while tabs stay, then warns (OpenCode changed). Each browser cleans its own. Its
  slim toolbar has only what Vltra adds: the phone's back button, state and title, where it runs (`project · worktree`, then the PR, as on its card; shrinks before the title), `✔ Done`
  (finished; phone only, the desktop card has its own) / Reopen (handled; neither for "folder deleted"), open in the terminal (`ocb://`,
  fine pointers only) or a new tab, close (desktop). Messages, asks, follow-ups and Stop happen in
  the chat. Being same-site, the iframe runs on Vltra's main thread: keep one chat mounted at a
  time (no hidden pages, no pools). The panel is not keyed by session: switching moves that one
  frame inside OpenCode's router (`showInChat` in `chat-navigation.ts`: `replaceState` +
  `popstate`, ~40ms) instead of a new frame starting OpenCode again (a second and more); a frame
  not loaded yet loads the URL instead.
- Mutations go through `VltraActions` (`app/vltra-actions.tsx`): the dashboard provides the server
  actions (the launcher's `launch`, `newSession`, `retireWorktree`, `dismissLaunch` and
  `suggestBranch` return `VltraActionValue`s when they carry a value), component tests provide
  recording fakes (`app/testing/dashboard-fixtures.tsx`:
  `WithVltra` for one card, `TestDashboard` for the whole dashboard with the URL in state, read
  back with `testLocation()`; `vltra-scenario.ts` is the shared vltra).
- Opening a session's panel marks its latest run viewed in OpenCode when it is unread there
  (`viewed` missing or `< idle`; its unread dots only, never Vltra state). The web shows no
  answer excerpts; `GET /api/vltra/sessions/:id/summary?idle=` (answer excerpt + change totals,
  cached in the runtime by `(id, idle)`; see `patterns/LONG_LIVED_WATCHER.md`) serves the
  terminal plugin's page.
- Look: the approved paper-and-ink mock (`app/globals.css` tokens, mono type, `attention` green
  and `destructive` red only, hairline borders, no shadows); light/dark follow the system
  (`prefers-color-scheme`), no toggle.
- PWA: `app/manifest.ts`, `app/icon.svg`, `app/apple-icon.png`, `public/icon-*.png` (no offline).
  Icons are the wordmark's pixel `v`: ink on paper for the home screen, rendered from
  `app/home-screen-icon.svg` with `rsvg-convert`; the favicon (`app/icon.svg`) at 42% on transparent (as
  vltra-old's), the status dot in its top-right corner.
- **Settings** (`?view=settings`, `settings-page.tsx`): notifications (DESIGN.md "Notifications").
  `use-push.ts` owns this browser's side: the service worker (`public/sw.js` at `/sw.js`, push and
  click only, never a `fetch` handler), its subscription and permission (`PushState`: on, off,
  denied, unsupported or iPhone-Safari-needs-the-Home-Screen-app). Turn on asks from the click
  (`Notification.requestPermission` before any `await`: Safari asks only within the gesture),
  subscribes with the server's VAPID key (`GET /api/vltra/notifications`) and saves the device
  (`savePushDevice`); Send a test (`testPush`); Turn off; other devices removable. The shell
  re-saves the subscription on every app open (`usePushRefresh`) and moves to a tapped
  notification's session without a reload (`useOpenFromNotification`, the worker's `vltra.open`
  message). Server: the notifier (`notifier.ts`, forked in the runtime) diffs consecutive store
  snapshots (`store.snapshots`) with `notify.ts` (blocked, or a new finished run, among rows in
  both, so the first snapshot is the baseline), rechecks each after 45 s / 2 min (still blocked;
  same run, not handled, not viewed), batches what comes due within 5 s, and broadcasts
  (`Push`, `lib/services/push/`). It keeps no record of what it sent.
- Deploys reload open pages (`use-reload-on-deploy.ts`): the live tree passes the build that
  rendered the page (`.next/BUILD_ID`, read once at boot: `lib/runtime/build-id.ts`, warmed in
  `instrumentation.ts`, since `pnpm ship` rewrites it under the running server); every time the
  event stream goes live the page asks `GET /api/vltra/version` and, on a different build,
  reloads at once when hidden or idle, else (focus in the chat iframe, a field, an open dialog)
  toasts "Vltra was updated" with Reload and reloads the next time the page is hidden.
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
pnpm dev               # portless run next dev (https://vltra.localhost); set OPENCODE_URL to a throwaway server
pnpm typecheck         # tsc --noEmit
pnpm lint              # oxlint, zero warnings
pnpm format:check      # oxfmt
pnpm test              # unit + integration (vitest)
pnpm build             # next build
pnpm verify            # format + typecheck + lint + test + build
pnpm ship              # build + systemctl --user restart vltra (a service run from this checkout)
pnpm vltra:import-handled [--dry-run]   # one-off rollout: viewed root runs → handled (never auto-run)
pnpm vltra:migrate-handled [--dry-run]  # one-off after the rename: metadata.fleet → metadata.vltra
```

**A checkout may be production.** If a `vltra` service runs `next start` from this checkout's
`.next` (check `systemctl --user status vltra`), `pnpm build` and `pnpm verify` rewrite `.next`
under the running server: its HTML keeps pointing at hashed CSS/JS that no longer exist, they
answer 500, and the live page renders unstyled until a restart. There: checks without the build
(`pnpm format:check && pnpm typecheck && pnpm lint && pnpm test --run`), or `pnpm ship` to build
and restart together; never a bare `pnpm build` / `pnpm verify`. Full `pnpm verify` belongs in a
separate worktree. `pnpm dev` is safe (Next 16 writes `.next/dev`). Commit before shipping: the
working tree at build time is what goes live.

## CONFIGURATION

| Variable                            | Default                                 | Purpose                                                                         |
| ----------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------- |
| `OPENCODE_URL`, `OPENCODE_PASSWORD` | unset → `Service.discover`              | Explicit endpoint (tests, dev)                                                  |
| `OPENCODE_SERVICE_FILE`             | `$XDG_STATE_HOME/opencode/service.json` | Registration file for discovery                                                 |
| `VLTRA_OPENCODE_WEB_URL`            | `https://vltra.localhost`               | Vltra's own public origin: OpenCode web UI base for deep links (`proxy.ts`)     |
| `VLTRA_SESSION_LIMIT`               | unset → every session                   | Optional cap on sessions loaded                                                 |
| `VLTRA_LAUNCHER_ROOTS`              | `~/dev/repos`                           | Launcher roots (`:` list, `~` ok): a repo, a folder of repos, or a plain folder |
| `VLTRA_BRANCH_MODEL`                | `opencode-go/qwen3.8-flash#none`        | Launcher branch suggestions (`generate.text` model, `#variant` ok)              |
| `VLTRA_USAGE_URL`                   | `http://127.0.0.1:8320`                 | The optional `usage` dashboard (magoz/usage); unreachable → no usage line       |
| `VLTRA_PUSH_FILE`                   | `$XDG_STATE_HOME/vltra/push.json`       | Web Push keys + devices (`push.dev.json` under `next dev`)                      |
| `VLTRA_LAUNCHER`                    | `opencode`                              | Where launches run: in-process, or `watcher` (a Watcher daemon)                 |
| `VLTRA_WATCHER_SOCKET`              | `$XDG_RUNTIME_DIR/watcher.sock`         | Watcher's API socket                                                            |
