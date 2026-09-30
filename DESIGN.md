# Fleet: one view of every OpenCode session on Box

Status: built (stages 1–4 live at https://fleet.oox.sh; terminal view in the dotfiles). Single user (magoz), private, Box only.

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

"Seen" is OpenCode's own: each session has `outcome` (`succeeded`/`failed`), `time.idle` and
`time.viewed`; a finished session is unseen while `viewed < idle` (core
`session/session.ts`). Any client viewing it (ocb, OpenCode web UI) advances `viewed`;
fleet's "Mark seen" calls `POST /api/session/:id/view { idle }`. Fleet stores nothing.

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
- Actions for the web UI are server actions (typed inputs, per 10x conventions): mark seen,
  reply to permission, answer form, send prompt, interrupt (proxied to OpenCode).
- The CLI plugin uses the two GET routes; opening a session in ocb marks it seen natively.

## Clients

**Web (fleet.oox.sh, Mac + phone):** one page. "Needs you" first (inline approve/deny and
form answers), then working, failed, done, grouped project → worktree. Tap a session for
its panel (full screen on the phone): last messages, changed files, prompt box, Interrupt,
Mark seen, and two ways out:
- **Open in OpenCode** → OpenCode's own web UI on the same server, verified deep link
  `https://box.tail129a86.ts.net:9446/server/<base64url(origin)>/session/<id>`
  (`app/src/shell/routes/session.ts`; server key = page origin). Works on Mac and phone after a
  one-time `opencode pair` per browser (30-day cookie).
- **Open in terminal** (Mac only) → `ocb://session/<id>`, handled by a tiny URL-scheme app that
  `macos/setup-box` installs and that opens a new Ghostty window running `ocb -s <id>`.
  The OpenCode desktop app registers no URL scheme, so it cannot be targeted.
- Copy `ocb -s <id>` as the always-works fallback. Live via SSE. Installable to the phone home screen.

**Terminal (CLI plugin in the dotfiles, runs inside `ocb`):**
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
