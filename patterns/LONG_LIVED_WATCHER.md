# Long-lived watcher inside Next

10x has no precedent for this: Vltra keeps one OpenCode event subscription open for the whole
life of the Next server (`next start` on Box, never serverless) and serves its state to pages,
route handlers and server actions.

## Runtime

- `lib/runtime/vltra-runtime.ts` builds one `ManagedRuntime` from `VltraLayer`:
  `VltraWatcherLive` (forks the watcher for the layer's lifetime) + `VltraStoreLive`
  (`SubscriptionRef` view + `PubSub` of `vltra.changed`) + `OpenCodeLive`.
- The runtime is stored on `globalThis` under `Symbol.for('vltra.runtime')`. Next bundles
  `instrumentation.ts`, each route handler and the server actions separately, so module state is
  not shared; dev reloads also re-evaluate modules. `globalThis` gives every bundle and every
  reload the same runtime, hence exactly one watcher. After changing watcher/store code in dev,
  restart `pnpm dev` (the old runtime keeps running the old code).
- `instrumentation.ts` `register()` starts it only when `NEXT_RUNTIME === 'nodejs'` and not during
  `next build` (Next already skips `register` in `phase-production-build`; the guard is explicit).
  It does not await the watcher: `register` must finish before the server accepts requests.
- Boundaries run Effects with `runVltra(effect)`. If the runtime was not started yet (e.g. a
  request raced `register`), `getVltraRuntime()` creates it lazily, so there is still only one.
- OpenCode endpoint config (`OPENCODE_URL`/`OPENCODE_PASSWORD`, `OPENCODE_SERVICE_FILE`,
  `VLTRA_SESSION_LIMIT`) is read **once when the layer is built**. `connect` is then called from
  many fibers (watcher cycles, actions); reading config per call would let a fiber outside the
  intended `ConfigProvider` silently fall back to discovering a different service.

## Resync rule

`connectOnce` in `lib/data/vltra/watcher.ts`:

1. `opencode.connect` (discover or override, then `GET /api/info`).
2. Subscribe to `GET /api/event` into an unbounded queue (`Stream.toQueue`).
3. Wait for the server's `server.connected` marker (sent after its feed subscription is live).
   Anything before it predates the subscription and is covered by the snapshot.
4. Load the snapshot (every session; `VLTRA_SESSION_LIMIT` is an optional cap), replace the
   model (running sessions count as active at the connect time), mark `connected`, and queue an
   interrupt-reason recovery pass (below).
5. Drain buffered then live signals through the pure state machine. The state machine is
   idempotent for events already reflected in the snapshot (`time.idle` only advances for
   terminal events newer than the known idle, while a replayed one still names its interrupt
   reason; `viewed` is a monotone max; the handled marker is whatever the last
   `session.metadata.updated` carried). Every event is committed atomically
   (`store.commit(view => applyEvent(view.model, event))`), since recovery commits too.
6. When the stream ends or fails: mark `disconnected` (keep the stale model), wait `dropDelay`,
   and start over. Failed attempts retry with `Schedule.min([exponential(500ms), spaced(30s)])`;
   the schedule restarts fresh after each successful connection.

Events for sessions outside the snapshot window trigger a `session.get` first. Created, moved and
forked sessions are re-read (`RefreshSession`); `worktree.updated` re-reads the worktree list;
a `worktree.resolved` that changes project identity triggers a full `Resync`.

## Interrupt reasons and auto-handling

OpenCode puts an interruption's reason on the event only (`patterns/OPENCODE_SURFACE.md`). The
watcher keeps a `RunReasons` map (`sessionID:idle` → reason, or none) for its whole life, i.e.
once per process, across reconnects:

- A live `interrupted(user|inactivity|superseded)` event records its reason for the run. For a
  root session, `user` is auto-handled right away: read the session (stored `time.idle`), and
  write `handled = idle` unless already handled. OpenCode answers with
  `session.metadata.updated`, which the model applies like any other writer's marker.
- After every snapshot (connect or `Resync`) a recovery pass runs in its own fiber, one pass at a
  time (`Queue.sliding(1)` coalesces triggers): finished, unhandled root sessions that ended
  interrupted without a known reason get it from the map, or else from the session log (two
  reads at a time, result remembered). Recovered reasons are applied as `InterruptRecovered`
  (only to the run they were read for); `user` is auto-handled as above. Read failures are
  logged and retried on the next snapshot.

## Time-based counts

`counts.stuck` (working rows retrying or quiet for `quietAfter`, 10 minutes) changes with time
alone. `VltraWatcherLive` therefore re-projects the snapshot every `recount` (1 minute), and
`diffSnapshots` publishes a `vltra.changed` when only counts changed. Clients that render "quiet
Nm" recompute it from `activityAt` with the exported helpers in `state.ts`.

## SSE fan-out

`GET /api/vltra/events` subscribes to the store's `PubSub` (sliding, 256 per subscriber), then
emits `vltra.changed` with `initial: true` and current counts. Clients load `GET /api/vltra`
after that first event (and after every reconnect), so nothing falls between snapshot and stream.
Heartbeats are SSE comments every 15s.

## Cache tags from the watcher (DESIGN open question): not directly

`revalidateTag` cannot be called from the background watcher. Verified in the installed Next
16.3.3:

- Docs (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidateTag.md`):
  "`revalidateTag` can be called in Server Functions and Route Handlers."
- Implementation (`next/dist/server/web/spec-extension/revalidate.js`, `revalidate()`): it reads
  `workAsyncStorage.getStore()` and throws `Invariant: static generation store missing in
revalidateTag <tag>` (E263) when there is no request store; tags are queued on
  `store.pendingRevalidatedTags` and applied when the request finishes.
- Reproduced: calling `revalidateTag('vltra:projects', 'max')` outside a request throws exactly
  that invariant.
- `updateTag` is Server Actions only (it throws elsewhere), so it is for actions, not the watcher.

So if Vltra ever adds `'use cache'` helpers (`vltra:projects`, `vltra:session:<id>`), the watcher
must invalidate through a tiny internal route handler, e.g. `POST /api/internal/revalidate`
(loopback-only, shared secret from the environment, JSON `{ tags }`), which calls
`revalidateTag(tag, { expire: 0 })` inside a real request. Server actions keep using
`updateTag`. Stage 1 has no cached data: projects and worktrees live in the watcher model, which
the snapshot already reads, so nothing needs invalidation yet.

## Stage 2: no `'use cache'`; finished-run summaries in an Effect `Cache`

Vltra's only slow-changing OpenCode read is a finished run's answer excerpt and change totals
(`GET /api/vltra/sessions/:id/summary`, for the terminal plugin's page; the web shows none). It
lives in `SessionSummaries` (`lib/data/vltra/session-detail.ts`), an Effect `Cache` in the runtime
keyed by `(sessionID, idle)`:

- A run's answer and files are fixed once it is idle, and the next run gets a new `idle`, so
  entries never need invalidation (nothing for the watcher to call).
- Failures get a zero TTL, so an unreachable OpenCode is never cached. (It is unclear whether a
  `'use cache'` function that throws stores its error; the Effect `Cache` makes it explicit.)
- Capacity 500, TTL 1 day. A client may also keep a summary (`private, max-age=3600`).

Projects and worktrees still come from the watcher model.

## Launches: background work in the runtime

A launch (`lib/data/vltra/launches.ts`) waits minutes on `worktree.create`, so the `launch`
server action only validates, registers the repository (`location.get`), records the launch and
forks the rest with `Effect.forkIn` into the `Launches` layer's scope, i.e. the runtime's: the
request returns at once, and the fiber lives until the launch settles or the runtime is disposed
(a restart loses launches in flight, by design). The registry is part of the store's view
(`VltraView.launches`, `store.updateLaunches`), so the snapshot and `vltra.changed` carry it like
rows: `GET /api/vltra` has `launches`, and a change carries the whole list whenever any launch
changed. A ready launch is removed by the same fiber after 10 minutes; failed ones stay until
dismissed. PR lookups (`lib/services/repos/`) fork into the Repos layer's scope the same way, so
a lookup still running when the launcher list answers keeps going and fills the cache.

## Shutdown

`instrumentation.ts` also registers `stopVltraOnSignals()`: on SIGTERM/SIGINT the runtime is
disposed, which closes the store's `PubSub` and ends every open `GET /api/vltra/events` stream.
After `stopVltra` the runtime is never rebuilt; requests that race the shutdown (an EventSource
reconnecting over a kept-alive connection) fail.

Next's own handler closes the HTTP server and, in production, waits for every open connection
(`server.close()`; only dev closes them). The chat's proxied OpenCode connections (`proxy.ts`: its
`/api/event` stream, terminal WebSockets) never end on their own, and nothing in Vltra or Next can
close them, so they kept `next start` (and `systemctl restart vltra`) alive until systemd's stop
timeout: a 90s outage per deploy. `exitOnSignals` (`lib/runtime/shutdown.ts`) bounds it: the
process exits `shutdownGraceMs` (3s) after the signal, with Next's exit codes (143 / 130), unless
Next exits first. The deadline counts from the signal, not from `stopVltra`, since disposing can
itself wait (interrupting a `gh` or `git` call), and it is an unref'd timer outside the runtime it
disposes. Nothing that must finish runs at shutdown: actions run on the disposed runtime, no
`after()`. Launches are not Vltra's to finish: Watcher runs them (Vltra only follows them, and
picks them up again at boot), so a restart costs a launch nothing. The unit's `TimeoutStopSec` is
the backstop.

To check by hand: `next start` the build on a spare port with `OPENCODE_URL` at a stub that serves
an endless event stream, hold `/api/event` open through Vltra (`curl -N`), send SIGTERM: it exits
in about 3s (without the deadline it never does).
