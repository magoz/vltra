import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exitOnSignals, shutdownGraceMs } from '@/lib/runtime/shutdown'
import type { ShutdownSignal } from '@/lib/runtime/shutdown'

const setup = (stop: () => Promise<void>) => {
  const listeners = new Map<ShutdownSignal, () => void>()
  const exits: Array<number> = []
  const stops = { count: 0 }

  exitOnSignals({
    on: (signal, listener) => listeners.set(signal, listener),
    stop: () => {
      stops.count += 1

      return stop()
    },
    after: (ms, exit) => {
      setTimeout(exit, ms)
    },
    exit: code => exits.push(code)
  })

  const send = (signal: ShutdownSignal) => listeners.get(signal)?.()

  return { send, exits, stops }
}

const never = () => new Promise<void>(() => {})

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('exit on signals', () => {
  it('exits with 143 at the deadline after SIGTERM, even when stopping hangs', async () => {
    const { send, exits, stops } = setup(never)

    send('SIGTERM')

    expect(stops.count).toBe(1)

    await vi.advanceTimersByTimeAsync(shutdownGraceMs - 1)

    expect(exits).toEqual([])

    await vi.advanceTimersByTimeAsync(1)

    expect(exits).toEqual([143])
  })

  it('counts the deadline from the signal, not from a quick stop', async () => {
    const { send, exits } = setup(() => Promise.resolve())

    send('SIGTERM')
    await vi.advanceTimersByTimeAsync(shutdownGraceMs - 1)

    // Next exits by itself once its connections close; Fleet never exits early.
    expect(exits).toEqual([])

    await vi.advanceTimersByTimeAsync(1)

    expect(exits).toEqual([143])
  })

  it('logs a failed stop and still exits', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { send, exits } = setup(() => Promise.reject(new Error('dispose failed')))

    send('SIGTERM')
    await vi.advanceTimersByTimeAsync(shutdownGraceMs)

    expect(logged).toHaveBeenCalledWith('Fleet failed to stop', new Error('dispose failed'))
    expect(exits).toEqual([143])
  })

  it('exits with 130 after SIGINT', async () => {
    const { send, exits } = setup(never)

    send('SIGINT')
    await vi.advanceTimersByTimeAsync(shutdownGraceMs)

    expect(exits).toEqual([130])
  })

  it('acts on the first signal only', async () => {
    const { send, exits, stops } = setup(never)

    send('SIGTERM')
    await vi.advanceTimersByTimeAsync(1000)
    send('SIGINT')
    await vi.advanceTimersByTimeAsync(shutdownGraceMs)

    expect(stops.count).toBe(1)
    expect(exits).toEqual([143])
  })
})
