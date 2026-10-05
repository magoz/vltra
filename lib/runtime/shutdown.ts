export type ShutdownSignal = 'SIGTERM' | 'SIGINT'

const shutdownSignals: ReadonlyArray<ShutdownSignal> = ['SIGTERM', 'SIGINT']

/** 128 + the signal's number, as Next's own handler exits (`server/lib/start-server.js`). */
export const signalExitCodes: Readonly<Record<ShutdownSignal, number>> = {
  SIGTERM: 143,
  SIGINT: 130
}

/**
 * How long after the signal the process may take to exit. Next's handler waits for every open
 * connection, and the chat's proxied OpenCode streams (its event stream, terminal WebSockets)
 * never end on their own, so without a deadline a restart waits for systemd's stop timeout.
 */
export const shutdownGraceMs = 3000

export type ShutdownHooks = {
  /** Registers `listener` for `signal` (`process.once`). */
  readonly on: (signal: ShutdownSignal, listener: () => void) => void
  /** Fleet's own cleanup; it may hang or fail, the deadline holds either way. */
  readonly stop: () => Promise<void>
  /** Runs `exit` after `ms`, without keeping the process alive (an unref'd timer). */
  readonly after: (ms: number, exit: () => void) => void
  readonly exit: (code: number) => void
}

/**
 * On the first SIGTERM/SIGINT: starts `stop` and a deadline of `shutdownGraceMs` from the signal,
 * after which the process exits with the signal's code. Next exits on its own when it can (no
 * open connections), so the deadline only bounds it. Later signals are left to Next's handler.
 */
export const exitOnSignals = (hooks: ShutdownHooks): void => {
  let started = false

  for (const signal of shutdownSignals) {
    hooks.on(signal, () => {
      if (started) return

      started = true
      hooks.after(shutdownGraceMs, () => hooks.exit(signalExitCodes[signal]))
      hooks.stop().catch(error => console.error('Fleet failed to stop', error))
    })
  }
}
