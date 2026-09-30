# Fleet: one view of every OpenCode session on Box

Status: design, not built. Single user (magoz), private, Box only.

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

One row per root session (subagents nest under their parent and roll up into it).

| State | Meaning | Enters on | Leaves on |
|---|---|---|---|
| `needs-you` | a permission or form (agent question) is pending | `permission.asked`, `form.created` | `permission.replied`, `form.replied`, `form.cancelled` |
| `working` | executing | `session.execution.started`, `session.status` running | execution ended |
| `failed` | last run failed/errored | `session.execution.failed`, `session.step.failed` | next start, or seen |
| `done` | finished, not yet looked at | `session.execution.succeeded` / `interrupted` | seen |
| `idle` | nothing new | seen | next start |

Priority when several apply: needs-you > failed > working > done > idle. A parent is
`needs-you`/`working` if any descendant is.

"Seen" = opened in any client (OpenCode emits `session.viewed`; verify it covers ocb and
the web UI) or dismissed in fleet. Stored by fleet (SQLite), so every device agrees.

## OpenCode surface used (verified in v2.0.20 source)

- Stream: `GET /api/event` (all locations; live only, no replay; slow consumers are dropped).
- Snapshot: `GET /api/session`, `GET /api/project`, `GET /api/permission/request`,
  `GET /api/form`, `GET /api/session/active`, `GET /api/worktree/:projectID`.
- Actions: `POST /api/session/:id/permission/:requestID/reply`,
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
- Actions for the web UI are server actions (typed inputs, per 10x conventions): mark seen,
  reply to permission, answer form, send prompt, interrupt (proxied to OpenCode).
- The CLI plugin uses the two GET routes plus `POST /api/sessions/:id/seen` (it cannot call
  server actions).

## Clients

**Web (fleet.oox.sh, Mac + phone):** one page. "Needs you" first (inline approve/deny and
form answers), then working, failed, done, grouped project → worktree. Tap a session for
its last messages and a prompt box. Live via SSE. Installable to the phone home screen.

**Terminal (CLI plugin in dotfiles `cli.json`, runs inside `ocb`):**
- `home.footer.status` / `prompt.footer.status` badge: `2 need you · 3 working · 1 done`.
- Full-page route (`ctrl+x f`): same grouping; Enter opens the session
  (`router.navigate({ type: "session" })`), which also marks it seen.
- Jump to next `needs-you` session (key TBD, must not collide with OpenCode defaults).
- Mac notification via `attention.notify({ when: "blurred" })` on → needs-you and → done.

## Stack and repo

Same stack and conventions as `~/dev/repos/10x` (copy its tooling, not its product code):
Next.js 16 App Router, React 19, Effect v4, shadcn/ui (Base UI) + Tailwind v4, oxlint (with
the vendored anti-slop rules) + oxfmt, Vitest + `@effect/vitest`, Playwright, pnpm 11,
Node 24, `portless run next dev`, root-level `app/` `components/` `lib/` (no `src/`),
`AGENTS.md` + `patterns/` conventions.

Differences from 10x, on purpose:
- **No auth** (private, single user).
- **SQLite, not Postgres**: one small table for "seen" on Box (Drizzle + SQLite file under
  `~/.local/share/fleet/`). No Neon/sandbox provisioning.
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
- "Seen" store: `@effect/sql-sqlite-node` (SQLite file), behind a `SeenStore` service.
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
- `lib/data/fleet/` state machine, snapshot/resync, types (Effect Schema), seen store.
- `app/` dashboard page, API routes, server actions.
- `opencode-plugin/` workspace package: the OpenCode CLI plugin (OpenTUI/Solid) loaded from
  dotfiles `cli.json`.

Runs entirely on Box from this one checkout (`~/dev/repos/fleet`); no Vercel, no separate
deployment copy:
- `fleet.service` user unit runs `next start` from this checkout on a loopback port, in
  `session.slice` like opencode.service, `Restart=always`. Unit lives in the box repo.
- Iterate: edit, then `pnpm ship` (`pnpm build && systemctl --user restart fleet`).
- Portless static route `fleet.oox.sh` in the box repo's `portless/static-routes.json`, DNS
  A record `fleet.oox.sh` → 100.122.135.127.

## Build order

1. Scaffold from 10x tooling; watcher + state machine + SQLite "seen" + API routes, with
   tests against a throwaway `opencode serve` (state transitions, resync after disconnect).
2. Dashboard page on the Mac browser.
3. Terminal plugin in `ocb`.
4. Phone: needs a certificate the phone trusts (Portless CA is Mac-only today; reuse the
   aha.oox.sh Let's Encrypt renewal or install the CA on the phone).

## Open questions

- Does `session.viewed` fire for ocb and web views, and is it enough for "seen"?
- Can a background task outside a request call `revalidateTag` (see Cache Components)?
- Does the CLI plugin's fetch trust the Portless CA on the Mac (Bun runtime; may need
  `NODE_USE_SYSTEM_CA=1` or `NODE_EXTRA_CA_CERTS` in `ocb`)?
