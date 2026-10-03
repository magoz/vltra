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
  reopen, mark viewed, reply to permission, answer form, send prompt, interrupt (proxied to
  OpenCode).
- The CLI plugin uses the two GET routes for states (it never recomputes them) and writes
  `metadata.fleet.handled` itself, with the same read-modify-write rule.

## Clients

**Web (fleet.oox.sh, Mac + phone):** one page, two areas.
- **Sidebar = needs me only**, topped by a count line (`4 need you · 17 working · 2 stuck`).
  Blocked rows first (oldest wait first) with inline approve/deny and form answers; then
  finished rows (oldest first) with the answer excerpt, change totals, a red mark for failures,
  and **Handled** (undo toast). Subagent requests show on the parent's row and are answered
  in place. No "handle all".
- **Projects = every session**, no time limit yet (maybe 30 days later): project → worktree
  ordered by latest activity; in a worktree, needs-me and working sessions first, then handled
  ones newest first. Sessions outside any repository (OpenCode's global project) go in one
  "Other" group, last, each row showing its directory. Working rows show live activity and
  stuck labels; handled rows offer Reopen.
- Keyboard (Mac): `j`/`k` move through the sidebar, `Enter` opens, `h` handled (and next),
  `u` undo, `a`/`d` approve/deny. Phone: swipe a finished row to mark it handled.

Tap a session for its panel (full screen on the phone): last messages, changed files, prompt
box, Interrupt, Handled / Reopen, subagent tree, and two ways out:
- **Open in OpenCode** → OpenCode's own web UI on the same server, verified deep link
  `https://box.tail129a86.ts.net:9446/server/<base64url(origin)>/session/<id>`
  (`app/src/shell/routes/session.ts`; server key = page origin). Works on Mac and phone after a
  one-time `opencode pair` per browser (30-day cookie).
- **Open in terminal** (Mac only) → `ocb://session/<id>`, handled by a tiny URL-scheme app that
  `macos/setup-box` installs and that opens a new Ghostty window running `ocb -s <id>`.
  The OpenCode desktop app registers no URL scheme, so it cannot be targeted.
- Copy `ocb -s <id>` as the always-works fallback. Live via SSE. Installable to the phone home screen.

**Terminal (CLI plugin in the dotfiles, runs inside `ocb`):**
- `home.footer.status` / `prompt.footer.status` badge: the same count line as the sidebar.
- Full-page route (`ctrl+x f`): the needs-me list only (Projects stays on the web); Enter
  opens the session (`router.navigate({ type: "session" })`).
- `ctrl+x j`: jump to the next needs-me session, in sidebar order.
- A key inside a session marks it handled (writes `metadata.fleet` directly).
- Mac notification via `attention.notify({ when: "blurred" })` on → blocked.

**Later (not part of the redesign):** Web Push for blocked agents only (debounced, one
summary for bursts; subscriptions in a small file next to the app), mute for sessions to
ignore forever, and a "handle this batch" action per worktree.

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
  - a finished session's transcript tail for the detail view (`fleet:session:<id>`),
    invalidated when that session runs again.
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
