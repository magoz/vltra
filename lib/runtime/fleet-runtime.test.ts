import { describe, expect, it } from '@effect/vitest'
import { getFleetRuntime, stopFleet } from '@/lib/runtime/fleet-runtime'

// Belt and braces: nothing here may discover the live OpenCode service.
process.env.OPENCODE_SERVICE_FILE = '/nonexistent/fleet-runtime-test/service.json'

describe('fleet runtime shutdown', () => {
  it('never builds a new runtime once stopped', async () => {
    // Creating the runtime is lazy: nothing connects until an Effect runs on it.
    expect(getFleetRuntime()).toBe(getFleetRuntime())

    await stopFleet()

    expect(() => getFleetRuntime()).toThrow('Fleet is shutting down')
  })
})
