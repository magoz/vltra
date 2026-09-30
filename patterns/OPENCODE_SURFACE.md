# OpenCode surface (v2.0.20)

Everything here is verified against the v2.0.20 source (`packages/protocol/src/groups`,
`packages/schema/src`, `packages/core/src`) and a real `opencode serve`. None of it is a declared
stable API; the integration suite is the tripwire when OpenCode is upgraded.

## Client

- `@opencode/client/effect` `OpenCode.make({ baseUrl })` with an `HttpClient` that adds
  `Service.headers(endpoint)` (Basic `opencode:<password>`).
- Endpoint: `OPENCODE_URL` (+ `OPENCODE_PASSWORD`) if set, else
  `Service.discover` from `@opencode/client/effect/service` (registration file + `/api/info`
  health check). Never `Service.ensure`.
- All OpenCode types are mapped to Fleet types in `lib/services/opencode/mapping.ts`.

## Reads

| Purpose              | Call                                                               |
| -------------------- | ------------------------------------------------------------------ |
| Sessions             | `GET /api/session?limit=100` + `cursor.next`, newest-updated first |
| Active executions    | `GET /api/session/active`                                          |
| Loaded locations     | `GET /api/debug/location` (falls back to running sessions' dirs)   |
| Pending permissions  | `GET /api/permission/request?location[directory]=…` per location   |
| Pending forms        | `GET /api/form?location[directory]=…` per location                 |
| Projects / worktrees | `GET /api/project`, `GET /api/worktree?projectID=…`                |
| One session          | `GET /api/session/:id` (outside window, created/moved/forked)      |
| Transcript tail      | `GET /api/session/:id/message?order=desc&limit=…` (one page)       |
| Latest turn's files  | `GET /api/session/:id/diff?context=0` (patch text dropped)         |

Permissions and forms are **per location** in 2.0.20 (each loaded location has its own pending
map), so the DESIGN's `GET /api/permission/request` and `GET /api/form` are called once per
loaded location. Querying only loaded locations avoids booting new ones. Forms keep their fields
(Fleet's `FormField`, minus validation details; `hidden` fields are dropped, OpenCode applies their
default) so the dashboard can answer them inline; OpenCode validates the answer. Forms with the
temporary MCP `sessionID: "global"` owner are kept in the model but not attached to any row.

## Events → Fleet

`server.connected`, `session.execution.{started,succeeded,failed,interrupted}` (shutdown
interruptions do not advance `time.idle`), `session.step.failed`, `session.retry.scheduled`,
`session.status`, `session.viewed`, `session.created/moved/forked` (re-read), `session.deleted`,
`session.renamed`, `session.agent.selected`, `session.model.selected`, `session.usage.updated`,
`permission.asked/replied`, `form.created/replied/cancelled`, `project.updated`,
`worktree.updated`, `worktree.resolved`. Live activity (dashboard only, never a state change):
`session.step.started` / `session.reasoning.started` → thinking, `session.text.started` →
writing, `session.tool.input.started` → tool name, `session.tool.called` → tool input summary
(command, path, pattern, ...). Activity is cleared when a run starts or ends and is not in the
snapshot, so it is unknown until the next step after a (re)connect. Everything else (deltas,
progress, ...) is ignored. On location shutdown
OpenCode itself emits `permission.replied` (reject) and `form.cancelled` for pending requests.

## Seen state

OpenCode's projector sets `time.idle = max(event.created, previousIdle + 1)` on terminal
events and `time.viewed = max(viewed, idle)` on `session.viewed`. A session is unseen while
`viewed < idle`. "Mark seen" reads the stored `time.idle` (not the event time, which can differ
by the +1) and posts `POST /api/session/:id/view { idle }`.

## Test isolation (integration)

`lib/services/opencode/testing/opencode-server.ts` starts `opencode serve` on a random
loopback port with a random password and a rebuilt environment: `HOME`, `XDG_*`, `TMPDIR`,
`OPENCODE_CONFIG_DIR` and cwd under one temp directory, `OPENCODE_CONFIG_CONTENT={}`,
auto-update and models fetch disabled, `HTTP(S)_PROXY` pointed at a dead port. Sessions use
the unavailable model `fleet-none/none`, so prompts fail with `provider.no-route` without any
network call. (The default free `opencode` provider would otherwise answer real prompts.)
"Done" sessions are created with `POST /api/experimental/session/import`, pending requests with
`POST /api/session/:id/permission` (session rule `effect: ask`) and `POST /api/session/:id/form`.
