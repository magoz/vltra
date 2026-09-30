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
  fleet.service     127.0.0.1:<port>           (new, Effect v4, systemd user unit)
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

## Fleet API (served by fleet.service)

- `GET /api/fleet` → snapshot: projects → worktrees → sessions (state, title, agent,
  model, updated, cost, pending permission/form summary, children).
- `GET /api/fleet/events` → SSE: `fleet.changed` with changed rows (clients refetch on
  reconnect).
- `POST /api/sessions/:id/seen`
- `POST /api/sessions/:id/permission/:requestID` `{ reply }` (proxied to OpenCode)
- `POST /api/sessions/:id/form/:formID` `{ answers }` (proxied)
- `POST /api/sessions/:id/prompt` `{ text }` (proxied)

Effect `HttpApi` with Schema, so the web app and CLI plugin share typed clients.

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

## Repo and deploy

- `magoz/fleet` (private): `packages/server` (Effect v4 service), `packages/web` (static
  build served by the server), `packages/cli-plugin` (OpenCode CLI plugin), shared schema.
- Node 24 + pnpm; `effect` pinned to the version `@opencode/client@2.0.20` resolves.
- Box: `fleet.service` user unit in `session.slice` (like opencode.service), loopback
  port, Portless static route `fleet.oox.sh` added to the box repo's
  `portless/static-routes.json`, DNS A record `fleet.oox.sh` → 100.122.135.127.
- Dotfiles: add the CLI plugin to `cli.json` once published/installed.

## Build order

1. Server: snapshot + event stream + state machine + SQLite "seen" + API, with tests
   against a throwaway `opencode serve` (state transitions, resync after disconnect).
2. Web page on the Mac browser.
3. Terminal plugin in `ocb`.
4. Phone: needs a certificate the phone trusts (Portless CA is Mac-only today; reuse the
   aha.oox.sh Let's Encrypt renewal or install the CA on the phone).

## Open questions

- Does `session.viewed` fire for ocb and web views, and is it enough for "seen"?
- Does the CLI plugin's fetch trust the Portless CA on the Mac (Bun runtime; may need
  `NODE_USE_SYSTEM_CA=1` or `NODE_EXTRA_CA_CERTS` in `ocb`)?
- Web UI framework: plain Vite + React unless you prefer otherwise.
