import { Context } from 'effect'
import type { Effect } from 'effect'

/** The TCP ports each checked process tree listens on (none: not listening, gone or unreadable). */
export type ListeningPorts = ReadonlyMap<number, ReadonlyArray<number>>

export type ProcessesOperations = {
  /**
   * For each process id, the TCP ports (IPv4 and IPv6) it or any of its descendants listens on,
   * read from `/proc` on this machine (Vltra runs next to OpenCode, as the same user). Never
   * fails: anything unreadable counts as not listening.
   */
  readonly listening: (pids: Iterable<number>) => Effect.Effect<ListeningPorts>
}

/**
 * Processes on this machine. A background shell whose tree listens on a port is a service (a dev
 * server), which nobody waits on, unlike a script the agent will be woken by.
 */
export class Processes extends Context.Service<Processes, ProcessesOperations>()(
  '@vltra/Processes'
) {}
