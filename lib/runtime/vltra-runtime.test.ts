import { describe, expect, it } from '@effect/vitest'
import { getVltraRuntime, stopVltra } from '@/lib/runtime/vltra-runtime'

// Belt and braces: nothing here may discover the live OpenCode service.
process.env.OPENCODE_SERVICE_FILE = '/nonexistent/vltra-runtime-test/service.json'

describe('vltra runtime shutdown', () => {
  it('never builds a new runtime once stopped', async () => {
    // Creating the runtime is lazy: nothing connects until an Effect runs on it.
    expect(getVltraRuntime()).toBe(getVltraRuntime())

    await stopVltra()

    expect(() => getVltraRuntime()).toThrow('Vltra is shutting down')
  })
})
