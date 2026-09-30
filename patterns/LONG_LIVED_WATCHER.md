# Long-lived watcher inside Next

10x has no precedent for this: Fleet keeps one OpenCode event subscription open for the whole
life of the Next server (`next start` on Box, never serverless) and serves its state to pages,
route handlers and server actions.

## Runtime

- `lib/runtime/fleet-runtime.ts` builds one `ManagedRuntime` from `FleetLayer`:
  `FleetWatcherLive` (forks the watcher for the layer's lifetime) + `FleetStoreLive`
  (`SubscriptionRef` view + `PubSub` of `fleet.changed`) + `OpenCodeLive`.
- The runtime is stored on `globalThis` under `Symbol.for('fleet.runtime')`. Next bundles
  `instrumentation.ts`, each route handler and the server actions separately, so module state is
  not shared; dev reloads also re-evaluate modules. `globalThis` gives every bundle and every
  reload the same runtime, hence exactly one watcher. After changing watcher/store code in dev,
  restart `pnpm dev` (the old runtime keeps running the old code).
- `instrumentation.ts` `register()` starts it only when `NEXT_RUNTIME === 'nodejs'` and not during
  `next build` (Next already skips `register` in `phase-production-build`; the guard is explicit).
  It does not await the watcher: `register` must finish before the server accepts requests.
- Boundaries run Effects with `runFleet(effect)`. If the runtime was not started yet (e.g. a
  request raced `register`), `getFleetRuntime()` creates it lazily, so there is still only one.
- OpenCode endpoint config (`OPENCODE_URL`/`OPENCODE_PASSWORD`, `OPENCODE_SERVICE_FILE`,
  `FLEET_SESSION_LIMIT`) is read **once when the layer is built**. `connect` is then called from
  many fibers (watcher cycles, actions); reading config per call would let a fiber outside the
  intended `ConfigProvider` silently fall back to discovering a different service.

## Resync rule

`connectOnce` in `lib/data/fleet/watcher.ts`:

1. `opencode.connect` (discover or override, then `GET /api/info`).
2. Subscribe to `GET /api/event` into an unbounded queue (`Stream.toQueue`).
3. Wait for the server's `server.connected` marker (sent after its feed subscription is live).
   Anything before it predates the subscription and is covered by the snapshot.
4. Load the snapshot, replace the model, mark `connected`.
5. Drain buffered then live signals through the pure state machine. The state machine is
   idempotent for events already reflected in the snapshot (`time.idle` only advances for
   terminal events newer than the known idle; `viewed` is a monotone max).
6. When the stream ends or fails: mark `disconnected` (keep the stale model), wait `dropDelay`,
   and start over. Failed attempts retry with `Schedule.min([exponential(500ms), spaced(30s)])`;
   the schedule restarts fresh after each successful connection.

Events for sessions outside the snapshot window trigger a `session.get` first. Created, moved and
forked sessions are re-read (`RefreshSession`); `worktree.updated` re-reads the worktree list;
a `worktree.resolved` that changes project identity triggers a full `Resync`.

## SSE fan-out

`GET /api/fleet/events` subscribes to the store's `PubSub` (sliding, 256 per subscriber), then
emits `fleet.changed` with `initial: true` and current counts. Clients load `GET /api/fleet`
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
- Reproduced: calling `revalidateTag('fleet:projects', 'max')` outside a request throws exactly
  that invariant.
- `updateTag` is Server Actions only (it throws elsewhere), so it is for actions, not the watcher.

So when stage 2 adds `'use cache'` helpers (`fleet:projects`, `fleet:session:<id>`), the watcher
must invalidate through a tiny internal route handler, e.g. `POST /api/internal/revalidate`
(loopback-only, shared secret from the environment, JSON `{ tags }`), which calls
`revalidateTag(tag, { expire: 0 })` inside a real request. Server actions keep using
`updateTag`. Stage 1 has no cached data: projects and worktrees live in the watcher model, which
the snapshot already reads, so nothing needs invalidation yet.
