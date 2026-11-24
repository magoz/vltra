import { Context } from 'effect'
import type { Effect } from 'effect'

/** What a process tree (a process and its descendants) does that Vltra cares about. */
export type ProcessTree = {
  /** TCP ports (IPv4 and IPv6) it listens on, ascending. */
  readonly ports: ReadonlyArray<number>
  /**
   * A test runner (Playwright, Vitest, Jest, Cypress, …) runs in it: any server it listens with
   * is the tests' own (Playwright's `webServer`), which ends with them.
   */
  readonly runsTests: boolean
}

export type ProcessesOperations = {
  /**
   * Each process tree, read from `/proc` on this machine (Vltra runs next to OpenCode, as the
   * same user). Never fails: anything unreadable counts as not listening and not testing.
   */
  readonly inspect: (pids: Iterable<number>) => Effect.Effect<ReadonlyMap<number, ProcessTree>>
}

/**
 * Processes on this machine. A background shell whose tree listens on a port is a service (a dev
 * server), which nobody waits on, unlike a script the agent will be woken by; unless the tree
 * runs tests, whose servers come and go with them.
 */
export class Processes extends Context.Service<Processes, ProcessesOperations>()(
  '@vltra/Processes'
) {}
