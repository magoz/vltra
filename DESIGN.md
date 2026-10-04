# Fleet: one view of every OpenCode session on Box

Status: built (stages 1–4 live at https://fleet.oox.sh; terminal view in the dotfiles). Single user (magoz), private, Box only.
Redesign in progress (2026-10-03): attention model (working / needs me / handled), see Session state.

## Problem

6–10 OpenCode agents run at once across projects and worktrees on Box. OpenCode's
built-in session list (`ctrl+x l`) knows only `idle`/`running`: it cannot show which
sessions are waiting on me, which finished while I was away, or group them by
project/worktree, and it only exists while a client is open.

## Shape

```text
Box
  opencode.service  127.0.0.1:49374            (unchanged)
        ▲ loopback HTTP, auth via @opencode/client Service.discover/headers
  fleet.service     127.0.0.1:<port>           (new: Next.js app, `next start`, systemd user unit)
        ▲ Portless static route fleet.oox.sh → <port>   (like usage.oox.sh)
Mac browser / phone → https://fleet.oox.sh     (web dashboard)
Mac ocb             → fleet CLI plugin in dotfiles cli.json (terminal view)
```

- Fleet is an OpenCode **API client**, not an OpenCode server plugin. Server plugins and
  plugin RPC are per location in 2.0.20 (`makeLocationNode` in `core/src/plugin/instance.ts`,
  `core/src/rpc.ts`), so a global aggregator does not fit there, and nothing new runs inside
  OpenCode.
- No login: private tailnet, one user. Mutating endpoints reject cross-site requests
  (`Sec-Fetch-Site`/`Origin` must be same-origin, JSON only, no CORS).
- Fleet only discovers the systemd-owned OpenCode service; it never starts one
  (`Service.discover`, never `Service.ensure`).

## Session state

Fleet is about attention: with dozens of agents running, it shows what needs me and lets me
clear it. One row per root session; subagents fold into their parent (their pending
permissions/forms and their running state roll up; their finished runs do not).

A **run** is one OpenCode execution (`session.execution.started` → `succeeded` / `failed` /
`interrupted`); on its end OpenCode stamps `time.idle`, which identifies the run. Permissions
and forms pause a run, they do not end it.

| State | Group | Meaning | Leaves on |
|---|---|---|---|
| `blocked` | needs me | a permission or form is pending on the session or a descendant | answer / deny / cancel (never "handled") |
| `working` | | a run is active | the run ends |
| `finished` | needs me | the latest run ended (succeeded, failed, or interrupted by `inactivity`) and is not handled | I mark it handled |
| `handled` | | I handled the latest run, or the session never ran | the next run starts |

Priority: blocked > working > finished > handled.

- **Handled is mine and per run**: `metadata.fleet.handled = <time.idle of the handled run>`
  on the OpenCode session; the latest run is handled while `handled >= idle`. A new run that
  ends puts the session back in `finished` without any un-handle step. Fleet owns only the
  `fleet` key: read the session, replace `metadata.fleet`, write the whole object back
  (`PATCH session { metadata }` replaces it, and other writers such as plugins may exist).
  Writing metadata bumps `time.updated`, so Fleet orders by run times, never by `updated`.
- **Interrupts** carry a `reason` on the event only (the session row stores `interrupted`):
  `user` (any client's Stop: Fleet, ocb, web) → Fleet marks that run handled automatically;
  `inactivity` (OpenCode stopping an evicted location's runs) → `finished`, labelled "stopped
  by OpenCode"; `shutdown` → ignored (no `time.idle`, resumes after restart); `superseded` is
  declared but unused. If Fleet missed the event, it recovers the reason from `session.log`.
- **Failed** runs are `finished` with a red mark, not their own state.
- **Folder gone = handled**: a session whose folder no longer exists (a deleted `/tmp/tmp.*` scratch folder, a worktree removed after merge) is `handled` unless it is blocked or working, because OpenCode cannot write metadata for a session whose folder was deleted (so the marker could never be set); Fleet checks the folders itself (same machine) on every snapshot and every minute, and offers no Handled/Reopen for them ("folder deleted").
- **Stuck** is not a state: a working session shows `retrying (n×, reason)`
  (`session.retry.scheduled`) or `quiet Nm` (no step/tool activity for 10+ minutes). Shown in
  Projects and counted, never in the needs-me list.
- **Undo / Reopen** removes the handled marker, so the session is `finished` again.
- OpenCode's own "viewed" (`viewed < idle` = unread in OpenCode UIs) is independent: opening a
  session's panel in Fleet still calls `POST /api/session/:id/view { idle }` to keep OpenCode's
  unread dots right, but it never changes Fleet state.
- **Rollout**: a one-off script (`pnpm fleet:import-handled`, run once at deploy, idempotent)
  marks every root session whose latest run was already viewed (`viewed >= idle`) as handled.
  It is never run automatically: after it, "viewed" means nothing to Fleet.

Fleet stores nothing itself: OpenCode's session metadata is its database. (Exception, later:
Web Push subscriptions.)

## OpenCode surface used (verified in v2.0.20 source)

- Stream: `GET /api/event` (all locations; live only, no replay; slow consumers are dropped).
- Snapshot: `GET /api/session`, `GET /api/project`, `GET /api/permission/request`,
  `GET /api/form`, `GET /api/session/active`, `GET /api/worktree/:projectID`.
- Actions: `POST /api/session/:id/permission/:requestID/reply`, `POST /api/session/:id/view`,
  `POST /api/session/:id/form/:formID/reply`, `POST /api/session/:id/prompt`,
  `POST /api/session/:id/interrupt`.
- Events: `session.execution.{started,succeeded,failed,interrupted}`, `session.status`,
  `session.retry.scheduled`, `session.step.failed`, `session.created/deleted/renamed/moved`,
  `session.viewed`, `permission.asked/replied`, `form.created/replied/cancelled`,
  `worktree.updated`, `project.updated`.
- Questions are **forms** in V2 (`question.*` is V1-only schema).

Resync rule: subscribe to `/api/event` first, then load the snapshot, then apply buffered
events; on any disconnect, repeat. Pin OpenCode 2.0.20 and test against a real
`opencode serve` because none of this is a declared-stable API.

## Fleet API (Next route handlers)

- `GET /api/fleet` → snapshot: projects → worktrees → sessions (state, title, agent,
  model, updated, cost, pending permission/form summary, children).
- `GET /api/fleet/events` → SSE: `fleet.changed` with changed rows (clients refetch on
  reconnect).
- Actions for the web UI are server actions (typed inputs, per 10x conventions): mark handled,
  reopen, mark viewed (OpenCode's unread marker). Asks, follow-ups and Stop happen in OpenCode's
  own chat.
- The terminal plugin (runs on the Mac, talks to Fleet over HTTPS) uses the GET routes for
  states (it never recomputes them) and Fleet's JSON mutation routes for handled / reopen /
  launch / dismiss (`POST /api/fleet/sessions/:id/handled`, `.../reopen`, `/api/fleet/launches`,
  `/api/fleet/launches/:id/dismiss`), same rules and same-origin check as the web's server
  actions (the plugin sends Fleet's own `Origin`). Fleet stays the only writer of
  `metadata.fleet`.
- Mutation routes (`app/api/fleet/mutations.ts`; schemas in `lib/data/fleet/types.ts`, bodies
  `LaunchInput` / `OpenCheckoutInput` in `launcher.ts`): `POST`, `Content-Type: application/json`
  and same-origin, `cache-control: no-store`.
  - `/api/fleet/sessions/:id/handled` `{}` → `{ sessionID, outcome: 'handled' | 'already-handled' }`
  - `/api/fleet/sessions/:id/reopen` `{}` → `{ sessionID, outcome: 'reopened' | 'not-handled' }`
  - `/api/fleet/launches` `{ repoDir, branch, task }` → `{ launchID }` at once (progress in the
    snapshot's and `fleet.changed`'s `launches`)
  - `/api/fleet/launches/:id/dismiss` `{}` → `{ launchID }`
  - `/api/fleet/checkouts/open` `{ directory }` → `{ sessionID, created }` (latest root session
    there, else a new empty one)
  - Failures are `{ error }` with the server action's message: 400 invalid input / not a
    checkout, 403 cross-site (or no `Origin`), 404 unknown session / launch, 409 not finished /
    folder gone / launch still running / OpenCode refused, 415 not JSON, 502 an OpenCode call
    failed, 503 OpenCode unreachable.
- Launcher: `GET /api/fleet/launcher` → `LauncherList` (repos with worktrees, owner, PR, session
  tallies and latest root session, most recent activity first); `POST /api/fleet/launcher/branch`
  `{ task }` → `{ branch, source: 'model' | 'fallback' }` (JSON only, same-origin: a non-browser
  client sends `Origin` with Fleet's own origin). The web UI uses the server actions `launch`,
  `openCheckout`, `retireWorktree`, `dismissLaunch` and `suggestBranch`; launches reach clients in
  the snapshot (`launches`) and in `fleet.changed`.

## Clients

**Web (fleet.oox.sh, Mac + phone):** two full-width pages, **Agents** and **Projects**, as three
tabs: **Agents** (focus mode), **Board** (Agents' board mode) and **Projects** (`1` / `2` / `3`).
Desktop: the tabs sit in the header, which also carries the count line (`6 need you · 17 working
· 2 stuck`). Phone: no header; a bottom tab bar `Agents | Board | Projects | +`, plus a slim
`reconnecting…` line on top only once a reconnect lasts 3s (page loads and a woken phone stay
quiet).
- **Agents has two modes** (`?view=board` for the board; focus is the default, so plain `/` is
  focus):
  - **Focus (default)**: a left sidebar with only the needs-me list (blocked first, oldest wait
    first; then finished, oldest first, with Handled; rows are just project · worktree, title and
    age, no asks or answer excerpts, since the chat has them), and the selected session open
    inline in the rest of the page: its chat, the same panel as the drawer. Nothing selected: a
    quiet empty state. Handling the open session opens the next needs-me session, so triage is
    `h`, `h`, `h`. Working and handled sessions are not listed (they are on Board; the desktop
    count line still counts them).
  - **Board**: the four-column kanban below, with the drawer. Its own tab (`b` toggles Agents ↔
    Board); the mode lives in the URL so links and the back button keep it.
- **Agents board = a kanban by state** across all projects, columns `Blocked | Finished |
  Working | Handled` (the two left columns are "needs me"). Cards are minimal, like focus mode's
  rows: project · worktree, title and age, a red mark for failures; asks, answers and live
  activity are left to the chat. Blocked: oldest wait first. Finished: oldest first, **Handled**
  (undo toast). Working: stuck first, with the stuck label. Handled column: last 24h only, then
  "N more → Projects"; cards offer Reopen. No drag and drop (columns show state; actions are buttons and
  keys). No "handle all". A project filter (`?project=`, chip with ×) narrows the board to one
  project.
- **Projects = a grid of project cards** (2–3 columns desktop, 1 on the phone), ordered by
  latest activity, "Other" (sessions outside any repository, each showing its directory)
  last. Card header: name + counts; clicking it opens Agents filtered to that project. Inside,
  worktrees are sections listing needs-me and working sessions; handled ones fold into
  "N handled · last 2h", expandable in place (Reopen there). No time limit yet (maybe 30 days
  later).
- **Phone**: focus mode is the needs-me list; tapping a session opens its chat full screen
  (Handled in its toolbar opens the next needs-me session), back returns to the list. Board mode
  shows one column at a time via a segmented control (`Blocked 2 · Finished 4 · Working 5 ·
  Handled`), opening on the first non-empty needs-me column. Swipe left on a finished card marks
  it handled (no horizontal column scrolling, so the gesture stays unambiguous).
- **Keyboard (Mac)**: `1` / `2` / `3` the tabs. Focus: `j`/`k` move through the list, `Enter`
  opens the session on the right, `h` handled (the next needs-me session opens), `u` undo, `b`
  board. Board: `j`/`k` (`↓`/`↑`) within a column, `←`/`→` between columns, `h` handled (and next
  finished card), `u` undo, `Enter` opens the drawer, `Esc` closes, `/` focuses the project
  filter; focus starts on the first needs-me card. Projects: arrows move between cards, `j`/`k`
  within a card, `Enter` on a card opens its filtered board. No key answers asks: that happens in
  the chat.

Tap a session for its panel (a right-side drawer over the board and Projects, inline in focus
mode, full screen on the phone): the session's chat, nothing else (no Summary tab; messages,
changes, the prompt and subagents are all in the chat):
- **The chat** → OpenCode's own web UI on the same server, framed, verified deep link
  `https://box.tail129a86.ts.net:9446/server/<base64url(origin)>/session/<id>`
  (`app/src/shell/routes/session.ts`; server key = page origin). Works on Mac and phone after a
  one-time `opencode pair` per browser (30-day cookie).
- **Toolbar**: only what Fleet adds: Handled / Reopen, open the chat in a new tab, and
  **Open in terminal** (Mac only) → `ocb://session/<id>`, handled by a tiny URL-scheme app that
  `macos/setup-box` installs and that opens a new Ghostty window running `ocb -s <id>`.
  The OpenCode desktop app registers no URL scheme, so it cannot be targeted.
- Live via SSE. Installable to the phone home screen.

**Launcher and worktrees (web; the terminal plugin uses the same Fleet routes):** a
sessionizer for agents. Everything that touches disk runs on Box; clients only call Fleet and
OpenCode.
- **Open it**: header **New** + `n` / `⌘K` (palette), phone **+** in the tab bar, **+** on each
  Projects card (repo preselected). Type to fuzzy-match repos and their worktrees, most recent
  agent activity first; the last row is `+ New worktree in <repo>…`.
- **Pick an existing repo or worktree** → open its latest root session (focus mode, Chat), or a
  new empty session there if it has none.
- **New worktree** → describe the task; Fleet suggests a conventional branch (`feat/` `fix/`
  `chore/` `docs/` + short kebab, via OpenCode `generate.text`, falling back to a slug; always
  editable) → OpenCode `worktree.create({ projectID, name })` with `name =
  branch.replaceAll('/', '--')` → `session.create` in the returned directory →
  `session.prompt(task)` → land in that session. The dotfiles `worktrees` server plugin turns the
  create into the provisioned sibling checkout `<repo>-<branch-slug>` on a named branch from
  origin's fresh default tip (env/db/setup); it can take minutes, so the launch shows as a
  "provisioning…" entry until the session exists (or an error with what was preserved).
  Repos OpenCode has never opened are registered first (`location.get` with the directory).
- **List source**: `GET /api/fleet/launcher` — the sessionizer roots (`~/dev/repos/*`,
  `~/.dotfiles`, `~/aha`, `~/collie`, `~/subs`; configurable) that are git repos, merged with
  OpenCode's projects; each repo with its linked worktrees (branch, directory, owner: `dotfiles`
  marker = Fleet/OpenCode-managed, else Pi/Herdr), sessions and states.
- **Retire**: on worktree sections (Projects), only for marker-owned worktrees, disabled while
  any session there is working or blocked; confirms, then OpenCode `worktree.remove({ force:
  false })` → `worktree-manage` retirement (database leases released, never forced, branch
  kept). Sessions there become "folder deleted" (handled).
- **PR status**: Fleet looks up each worktree branch's PR with `gh` on Box (cached) and marks
  `merged · retire` / `closed · retire`. Automatic cleanup on merge/close is a later switch.

**Terminal (CLI plugin in the dotfiles, runs inside `ocb` on the Mac):**
- **Focus sidebar**: a Fleet section prepended above OpenCode's own sections in the session
  sidebar (`sidebar.content` slot, `prepend`; Context/MCP/LSP/todos stay below). One "Fleet"
  title with working/stuck counts, then one line per entry: launches, then blocked (oldest wait
  first, with the ask on a second line), then finished (oldest first). The current session is
  marked with a blue `▌` and reads `this session`; at most 6 session rows, then `+N more`.
  Empty → "Nothing needs you". Colours: needs-you is Fleet's green (markers and badge), failures
  red, current session blue; never OpenCode's warning or accent. No key hints in the sidebar.
  OpenCode 2.0.20 puts the sidebar on the right only (`session.sidebar: "auto"` shows it above
  120 columns, `ctrl+x b` toggles it) and it cannot take keyboard focus, so rows (and the undo
  line) are clicked, never keyed. Permissions/questions are answered natively in the session.
- Keys (global leader commands, all also in the palette; plugin option `keys` overrides them,
  since `cli.json` keybinds only accept built-in ids): `ctrl+x o` launcher, `ctrl+x h` handled
  (current session's root), `ctrl+x z` undo/reopen the last handled, `ctrl+x j` next needs-me,
  `ctrl+x f` page. (`ctrl+x n` / `ctrl+x u` are OpenCode's own session.new / session.undo.)
- **Launcher** `ctrl+x o`: the web launcher's flow in OpenCode's select dialog (repos/worktrees
  from `GET /api/fleet/launcher`, open via `checkouts/open`, new worktree with task + suggested
  branch → `POST /api/fleet/launches`; navigate into the session when ready if you have not
  moved, else a toast).
- Badge (`home.footer.status` / `prompt.footer.status`): `N need you · N working · N stuck`,
  `⚑ N need you` in green.
  Page `ctrl+x f`: needs me, then working (Projects stays on the web).
- Mac notification via `attention.notify({ when: "blurred" })` on → blocked (gaps only by
  default, as before).

**Later (not part of the redesign):** Web Push for blocked agents only (debounced, one
summary for bursts; subscriptions in a small file next to the app), mute for sessions to
ignore forever, and a "handle this batch" action per worktree. Video attachments (deferred): OpenCode forwards only images/PDF/text to the model
(`core/src/session/runner/to-llm-message.ts`) and the TUI composer only attaches images/PDF
(`tui/src/component/prompt/local-attachment.ts`; no plugin can extend it). Plan: a dotfiles
server plugin on the documented `session.prompt` hook that saves a video on Box and replaces it
with `ffmpeg` key frames (as image attachments) plus a note with the saved path; inputs via a
terminal-plugin "Attach video" command (inline, ≤20 MB) and/or Taildrop (`tailscale file get`
into `~/Taildrop`) with video paths in the prompt text resolved there.

## Stack and repo

Same stack and conventions as `~/dev/repos/10x` (copy its tooling, not its product code):
Next.js 16 App Router, React 19, Effect v4, shadcn/ui (Base UI) + Tailwind v4, oxlint (with
the vendored anti-slop rules) + oxfmt, Vitest + `@effect/vitest`, Playwright, pnpm 11,
Node 24, `portless run next dev`, root-level `app/` `components/` `lib/` (no `src/`),
`AGENTS.md` + `patterns/` conventions.

Differences from 10x, on purpose:
- **No auth** (private, single user).
- **No database**: all state comes from OpenCode (including "seen"); fleet is stateless.
- **Effect pinned to `4.0.0-rc.112`**, the exact version `@opencode/client@2.0.20` depends on,
  so there is one Effect runtime and no overrides (10x is on rc.115 because of Yolk).
- **Long-lived watcher inside Next**: `instrumentation.ts` `register()` (Node runtime) starts
  the OpenCode watcher once in a `ManagedRuntime` (guarded against dev reloads); route
  handlers and server actions read its state. Box runs `next start`, never serverless.
  10x has no precedent for this, so it gets its own pattern note.

Effect everywhere (10x `patterns/EFFECT_*.md`, `TYPESCRIPT_CONVENTIONS.md`):
- OpenCode access via `@opencode/client/effect` (typed Effects/Streams), wrapped in an
  `OpenCode` `Context.Service` + `Layer` with `Schema.TaggedError` errors.
- Watcher = one scoped Effect program: `Stream` over `/api/event`, `Schedule` backoff on
  disconnect, resync (subscribe → snapshot → apply buffered), state in a `SubscriptionRef`,
  changes fanned out through a `PubSub` that the SSE route consumes.
- Fleet state machine is a pure function (event → state), tested exhaustively.
- Everything composed into one `ManagedRuntime` started from `instrumentation.ts`; pages,
  route handlers and server actions run Effects against it (10x `NextEffect` helpers,
  `catchTag` chains, `Schema` parsing at every boundary).
- Tests: `@effect/vitest`, `TestClock` for backoff/timeouts, fake services via typed
  layers (no module mocking), plus an integration suite against a real throwaway
  `opencode serve`.

Cache Components (as in 10x `next.config.ts` and `patterns/EFFECT_PAGES.md`):
- `cacheComponents: true`, `partialPrefetching: true`; no removed route-segment options
  (`dynamic`, `revalidate`, `fetchCache`, `dynamicParams`).
- Dashboard route shell (header, section chrome, filters) is prerendered. The live fleet
  list is request-fresh (it reads the in-process watcher), so it sits in the smallest
  `<Suspense>` boundary with a shape-matched skeleton and `await connection()`; the client
  then keeps it live from `GET /api/fleet/events`.
- `'use cache'` helpers with `cacheTag` for slow-changing OpenCode data:
  - projects and worktrees (`fleet:projects`), invalidated on `project.updated` /
    `worktree.updated`;
  - a finished run's summary for its card (`fleet:session:<id>`), invalidated when that
    session runs again.
  Server actions use `updateTag` after mutations. Whether the background watcher (started
  from `instrumentation.ts`, outside a request) may call `revalidateTag` must be verified in
  the installed Next docs (`node_modules/next/dist/docs/`); otherwise it goes through a
  tiny internal route.
- `GET /api/fleet` and the SSE route read runtime state, so they stay request-time.

Layout:
- `lib/services/opencode/` OpenCode client (discover, never ensure) + event stream.
- `lib/data/fleet/` state machine, snapshot/resync, types (Effect Schema).
- `app/` dashboard page, API routes, server actions.
- Terminal view: an OpenCode CLI plugin in the dotfiles (`home/opencode/.config/opencode/plugins/
  fleet/`, auto-discovered, plain JS), so both Macs get it; it only reads `/api/fleet` and
  `/api/fleet/events`. Keys: `ctrl+x f` page, `ctrl+x j` next needs-you. Notifications only
  fill gaps in OpenCode's built-in ones (subagent-originated needs-you).

Runs entirely on Box from this one checkout (`~/dev/repos/fleet`); no Vercel, no separate
deployment copy:
- `fleet.service` user unit runs `next start` from this checkout on a loopback port, in
  `session.slice` like opencode.service, `Restart=always`. Unit lives in the box repo.
- Iterate: edit, then `pnpm ship` (`pnpm build && systemctl --user restart fleet`).
- Portless static route `fleet.oox.sh` in the box repo's `portless/static-routes.json`, DNS
  A record `fleet.oox.sh` → 100.122.135.127.

## Build order

1. Scaffold from 10x tooling; watcher + state machine + API routes, with
   tests against a throwaway `opencode serve` (state transitions, resync after disconnect).
2. Dashboard page on the Mac browser.
3. Terminal plugin in `ocb`.
4. Phone: needs a certificate the phone trusts (Portless CA is Mac-only today; reuse the
   aha.oox.sh Let's Encrypt renewal or install the CA on the phone).

## Open questions

- `ocb://` handler: how Ghostty launches a new window with a command on macOS (test on a Mac).
- Can a background task outside a request call `revalidateTag` (see Cache Components)?
- Does the CLI plugin's fetch trust the Portless CA on the Mac (Bun runtime; may need
  `NODE_USE_SYSTEM_CA=1` or `NODE_EXTRA_CA_CERTS` in `ocb`)?
