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
| Sessions (all)       | `GET /api/session?limit=100` + `cursor.next`, newest-updated first |
| Active executions    | `GET /api/session/active`                                          |
| Loaded locations     | `GET /api/debug/location` (falls back to running sessions' dirs)   |
| Pending permissions  | `GET /api/permission/request?location[directory]=…` per location   |
| Pending forms        | `GET /api/form?location[directory]=…` per location                 |
| Projects / worktrees | `GET /api/project`, `GET /api/worktree?projectID=…`                |
| One session          | `GET /api/session/:id` (outside window, created/moved/forked)      |
| Transcript tail      | `GET /api/session/:id/message?order=desc&limit=…` (one page)       |
| Latest turn's files  | `GET /api/session/:id/diff?context=0` (patch text dropped)         |
| A run's end (missed) | `GET /api/experimental/session/:id/log` (`follow: false`)          |

Permissions and forms are **per location** in 2.0.20 (each loaded location has its own pending
map), so the DESIGN's `GET /api/permission/request` and `GET /api/form` are called once per
loaded location. Querying only loaded locations avoids booting new ones. Forms keep their fields
(Fleet's `FormField`, minus validation details; `hidden` fields are dropped, OpenCode applies their
default) on the wire rows; Fleet itself never answers them (OpenCode's chat does). Forms with the
temporary MCP `sessionID: "global"` owner are kept in the model but not attached to any row.

## Launcher calls

The launcher (`lib/data/fleet/launcher.ts`, `launches.ts`) adds these, each mapped in
`mapping.ts` and exposed on `OpenCodeConnection`:

| Purpose                   | Call                                                                 |
| ------------------------- | -------------------------------------------------------------------- |
| Register / resolve a repo | `GET /api/location?location[directory]=…` (`location.get`)           |
| Create a worktree         | `POST /api/worktree { projectID, name }` (`worktree.create`)         |
| Retire a worktree         | `DELETE /api/worktree { projectID, directory, force: false }`        |
| A worktree list           | `GET /api/worktree?projectID=…` (`[{ directory, strategy? }]`)       |
| Create a session          | `POST /api/session { location: { directory }, title }`               |
| Send the task             | `POST /api/session/:id/prompt { text }` (returns the queued message) |
| One branch name           | `POST /api/experimental/generate { prompt }` (`generate.text`)       |

- `location.get` registers the project of a directory OpenCode never opened and returns
  `{ directory, project: { id, directory, canonical } }`; Fleet keeps `project.canonical` as the
  project directory (the same value `GET /api/project` calls `canonical`).
- `worktree.create` is synchronous: it answers once the strategy is done, which with the dotfiles
  `worktrees` plugin means a provisioned checkout (minutes). `fetch` (undici) gives up waiting for
  response headers after 5 minutes, so worktree calls use their own client
  (`NodeHttpClient.makeUndici`, which leaves time limits to `Effect.timeout`: 35 minutes for
  create, 21 for remove, matching the plugin's bounds). Fleet sends `name =
branch.replaceAll('/', '--')` (`branch.ts`; the plugin decodes `--` back to `/`).
- OpenCode's **default `git` strategy** (no plugin, e.g. the integration server) ignores the
  branch: it checks out a **detached** worktree at `$XDG_DATA_HOME/opencode/worktree/<id>/<name>`
  and suffixes a colliding name (`feat--x-2`) instead of refusing.
- Refusals are 4xx bodies with a message: the worktree group's
  `{ name: 'WorktreeError', data: { message, forceRequired } }` (e.g. `Invalid worktree
directory: …`, a dirty checkout, the plugin's preflight and `worktree-manage` refusals),
  `InvalidRequestError` / `ProjectNotFoundError` / `ConflictError` `{ _tag, message }`.
  `refusalMessage` decodes them (sanitized: no escapes or control characters, one line, 400
  chars) into `OpenCodeRejectedError`, whose message reaches the user; anything else stays a
  generic `OpenCodeRequestError`.
- `generate.text` without a usable model fails fast (`InvalidRequestError: No model specified…`
  or `ServiceUnavailableError` through the dead proxy); Fleet then uses its fallback slug.
- `session.prompt` returns as soon as the message is queued; the run (and its failure without a
  model) happens afterwards.

## Events → Fleet

`server.connected`, `session.execution.{started,succeeded,failed,interrupted}` (see Interrupt
reasons), `session.retry.scheduled`, `session.status`, `session.viewed`,
`session.metadata.updated` (handled marker), `session.created/moved/forked` (re-read),
`session.deleted`, `session.renamed`, `session.agent.selected`, `session.model.selected`,
`session.usage.updated`, `permission.asked/replied`, `form.created/replied/cancelled`,
`project.updated`, `worktree.updated`, `worktree.resolved`. Live activity (never a state change):
`session.step.started` / `session.reasoning.started` → thinking, `session.text.started` →
writing, `session.tool.input.started` → tool name, `session.tool.called` → tool input summary
(command, path, pattern, ...). Each of those (and the run start) also stamps the session's last
activity, which makes a working session "quiet" (stuck) after 10 minutes; a new step clears a
scheduled retry. Activity is cleared when a run starts or ends and is not in the snapshot: after a
(re)connect, running sessions count as active at the connect time. Everything else (deltas,
progress, `session.step.failed`, ...) is ignored. On location shutdown OpenCode itself emits
`permission.replied` (reject) and `form.cancelled` for pending requests.

## Handled marker (session metadata)

Fleet's only state is `metadata.fleet.handled = <time.idle of the handled run>`; the latest run is
handled while `handled >= idle`, so the next run that ends needs me again without an un-handle
step. Verified in 2.0.20 (`core/src/session/projector.ts`):

- `PATCH /api/session/:id { metadata }` **replaces** the whole object and bumps `time.updated`
  (so Fleet never orders by `updated`; rows carry `activeAt` from run times instead). It emits
  `session.metadata.updated` with the full new metadata.
- Writes are read-modify-write (`setHandled` in `live-layer.ts`, merge in `mapping.ts`
  `withFleetHandled`): read the session, keep every other key (other writers: plugins), replace
  only `fleet.handled`; clearing deletes it, and `fleet` once empty. Fleet is the only writer of
  `metadata.fleet`: the terminal plugin marks handled / reopens through Fleet's
  `POST /api/fleet/sessions/:id/handled` / `.../reopen` (same Effects as the server actions).
- Reading: `fleetHandled` decodes `metadata.fleet.handled` as a finite number; absent or malformed
  metadata reads as unhandled.
- Children and forks inherit the parent's metadata at creation (so a subagent may start with the
  parent's marker; only root rows are ever handled, and a child's own run ends later anyway).
- Mark handled reads the stored `time.idle` fresh (not the event time, which can differ by the
  +1 of `time.idle = max(event.created, previousIdle + 1)`) and writes it.
- A deleted location folder blocks every location-scoped call: OpenCode resolves the location
  with `realPath` (`PlatformError: NotFound: FileSystem.realPath`) once it is not loaded, so
  `PATCH /api/session/:id` (and the diff) fail, 500 on 2.0.20 and 404 on 2.0.22, while
  `GET /api/session/:id` and messages still work. Fleet counts such sessions handled and skips
  those calls (`lib/services/directories/`).

OpenCode's own `time.viewed` (`viewed < idle` = unread in OpenCode UIs) is independent: opening
a session's panel posts `POST /api/session/:id/view { idle }` for OpenCode's unread dots, and
`pnpm fleet:import-handled` used it once to seed markers. Fleet state never reads it.

## Interrupt reasons

`session.execution.interrupted` carries `data.reason` (`user` | `inactivity` | `shutdown` |
`superseded`) on the event only; the session row stores just `outcome: interrupted`.

- `shutdown` does not stamp `time.idle` (the run resumes after the restart): it only stops the
  session.
- `user` (any client's Stop): for a root session the watcher reads the session and writes
  `handled = time.idle`, so a run I stopped myself never needs me.
- `inactivity` (OpenCode stopping an evicted location's runs) stays finished, labelled "stopped
  by OpenCode". `superseded` is declared but unused in 2.0.20.
- Missed while Fleet was down: after every snapshot, finished, unhandled root sessions that ended
  interrupted with no known reason get it from the durable session log
  (`GET /api/experimental/session/:id/log`, `follow: false`, which ends after its `log.synced`
  marker): the last terminal execution event that is not a shutdown. Results are cached per
  `(sessionID, idle)` for the life of the process, so each run's log is read at most once;
  `user` is then auto-handled as above.

## Test isolation (integration)

`lib/services/opencode/testing/opencode-server.ts` starts `opencode serve` on a random
loopback port with a random password and a rebuilt environment: `HOME`, `XDG_*`, `TMPDIR`,
`OPENCODE_CONFIG_DIR` and cwd under one temp directory, `OPENCODE_CONFIG_CONTENT={}`,
auto-update and models fetch disabled, `HTTP(S)_PROXY` pointed at a dead port. Sessions use
the unavailable model `fleet-none/none`, so prompts fail with `provider.no-route` without any
network call. (The default free `opencode` provider would otherwise answer real prompts.)
The launcher suite (`launcher.integration.test.ts`) also sets `OPENCODE_CONFIG_CONTENT` to an
unavailable default model and creates temp git repositories under the server's own temp folder;
launches there use the default `git` strategy (the dotfiles plugin is not loaded).
Finished sessions are created with `POST /api/experimental/session/import`, pending requests with
`POST /api/session/:id/permission` (session rule `effect: ask`) and `POST /api/session/:id/form`,
other writers' metadata with `PATCH /api/session/:id { metadata }`. No real run can be
interrupted there (no model answers and `session.shell` runs without an execution), so interrupt
reasons are covered by the fake-layer watcher tests; the integration suite only checks that the
session log is readable.
