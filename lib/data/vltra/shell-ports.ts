import { Effect, Layer, Option, Ref, Schedule } from 'effect'
import type { Duration } from 'effect'
import { VltraEvent } from '@/lib/data/vltra/events'
import { applyEvent } from '@/lib/data/vltra/model'
import type { VltraModel } from '@/lib/data/vltra/model'
import { VltraStore } from '@/lib/data/vltra/store'
import type { RunningShell } from '@/lib/data/vltra/types'
import { OpenCode } from '@/lib/services/opencode/service'
import { Processes } from '@/lib/services/processes/service'

// Which running shells are services: a background shell whose process tree listens on a port (a
// dev server) is not a script the agent waits on, so it must not hold its session working. A
// server starts listening a few seconds after its shell, so the check repeats.

/** How often running shells are checked. Cheap: a few `/proc` reads per shell. */
export const shellPortsEvery: Duration.Input = '5 seconds'

/** Shell ids whose process id was already looked up (once each, found or not). */
export type LookedUp = Ref.Ref<ReadonlySet<string>>

const samePorts = (left: ReadonlyArray<number> | undefined, right: ReadonlyArray<number>) =>
  left !== undefined && left.length === right.length && left.every((port, i) => port === right[i])

/**
 * Shells `shell.created` left without a process id whose session's run has ended: only those can
 * hold a session working, so only those are worth a lookup.
 */
const withoutPid = (model: VltraModel, tried: ReadonlySet<string>) =>
  Array.from(model.shells.values()).flatMap(shell => {
    const session = model.sessions.get(shell.sessionID)

    return shell.pid === undefined && !tried.has(shell.id) && session?.running === false
      ? [{ shell, directory: session.info.directory }]
      : []
  })

/** Reads the missing process ids from OpenCode (its shells, per location). */
const lookUpPids = (lookedUp: LookedUp) =>
  Effect.gen(function* () {
    const store = yield* VltraStore
    const model = (yield* store.view).model
    const missing = withoutPid(model, yield* Ref.get(lookedUp))

    if (missing.length === 0) return

    // Only shells still running are remembered, so the set stays small.
    yield* Ref.update(
      lookedUp,
      tried =>
        new Set([
          ...Array.from(tried).filter(id => model.shells.has(id)),
          ...missing.map(item => item.shell.id)
        ])
    )

    const opencode = yield* OpenCode
    const connection = yield* opencode.connect

    const record = (shellID: string, pid: number) =>
      store.commit(view => ({
        ...view,
        model: applyEvent(view.model, VltraEvent.ShellProcessFound({ shellID, pid }))
      }))

    yield* Effect.forEach(
      missing,
      ({ shell, directory }) =>
        Effect.gen(function* () {
          const pid = yield* connection.shellPid({ shellID: shell.id, directory })

          if (Option.isSome(pid)) yield* record(shell.id, pid.value)
        }),
      { concurrency: 4, discard: true }
    )
  })

/** The shells' ports by shell id, from their processes' (none: no process to check). */
const portsByShell = (
  shells: ReadonlyArray<RunningShell>,
  byPid: ReadonlyMap<number, ReadonlyArray<number>>
) =>
  new Map(
    shells.flatMap(shell => {
      const ports = shell.pid === undefined ? undefined : byPid.get(shell.pid)

      return ports === undefined ? [] : [[shell.id, ports] as const]
    })
  )

/**
 * One check: look up missing process ids, then the ports every running shell's process tree
 * listens on, committed only when they changed (a commit re-projects every row and wakes the
 * notifier). Failures wait for the next check.
 */
export const checkShellPorts = (lookedUp: LookedUp) =>
  Effect.gen(function* () {
    yield* lookUpPids(lookedUp).pipe(
      Effect.catch(error => Effect.logDebug('Shell process lookup failed', error.message))
    )

    const store = yield* VltraStore
    const before = (yield* store.view).model
    const shells = Array.from(before.shells.values())
    const pids = shells.flatMap(shell => (shell.pid === undefined ? [] : [shell.pid]))

    if (pids.length === 0) return

    const processes = yield* Processes
    const ports = portsByShell(shells, yield* processes.listening(pids))

    const changed = Array.from(ports).some(
      ([id, found]) => !samePorts(before.shellPorts.get(id), found)
    )

    if (!changed) return

    yield* store.commit(view => ({
      ...view,
      model: applyEvent(view.model, VltraEvent.ShellsChecked({ ports }))
    }))
  })

/** Checks running shells every `every` for the lifetime of the layer (the app's runtime). */
export const ShellPortsLive = (every: Duration.Input = shellPortsEvery) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const lookedUp: LookedUp = yield* Ref.make<ReadonlySet<string>>(new Set())

      yield* Effect.forkScoped(
        checkShellPorts(lookedUp).pipe(Effect.repeat(Schedule.spaced(every)), Effect.asVoid)
      )
    })
  )
