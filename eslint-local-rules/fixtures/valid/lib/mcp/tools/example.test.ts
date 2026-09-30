import { readFile } from 'fs/promises'
import { expect, it } from 'vitest'

it('keeps MCP test files executable while allowing Node dependencies', () => {
  expect(typeof readFile).toBe('function')
})
