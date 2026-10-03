import { describe, expect, it } from '@effect/vitest'
import { Option, Schema } from 'effect'
import {
  Branch,
  branchToName,
  fallbackBranch,
  fallbackLimit,
  nameToBranch,
  parseSuggestion,
  suggestionPrompt
} from '@/lib/data/fleet/branch'

describe('branchToName', () => {
  it('encodes `/` as `--` and round-trips', () => {
    for (const branch of ['feat/x', 'fix/api/retry', 'magoz/new-launcher', 'docs/v1.2_notes']) {
      const name = branchToName(branch)

      expect(Option.isSome(name)).toBe(true)
      expect(nameToBranch(Option.getOrThrow(name))).toBe(branch)
    }

    expect(branchToName('feat/x')).toEqual(Option.some('feat--x'))
    expect(branchToName('fix/api/retry')).toEqual(Option.some('fix--api--retry'))
  })

  it('refuses branches without an exact encoding', () => {
    for (const branch of [
      'main',
      'feat/',
      '/x',
      'feat//x',
      'feat/a--b',
      'feat/-x',
      'feat/x-',
      'feat/x y',
      'feat/x..y',
      'feat/x.lock',
      'feat/.x',
      'feat/ü',
      `feat/${'a'.repeat(120)}`
    ]) {
      expect(branchToName(branch)).toEqual(Option.none())
    }
  })

  it('is the Branch schema check', () => {
    expect(Schema.is(Branch)('feat/x')).toBe(true)
    expect(Schema.is(Branch)('feat/a--b')).toBe(false)
  })
})

describe('parseSuggestion', () => {
  it('accepts one conventional branch name, trimmed and unquoted', () => {
    expect(parseSuggestion('feat/new-launcher')).toEqual(Option.some('feat/new-launcher'))
    expect(parseSuggestion('  `fix/login-redirect`\n')).toEqual(Option.some('fix/login-redirect'))
    expect(parseSuggestion('"docs/readme-setup"')).toEqual(Option.some('docs/readme-setup'))
    expect(parseSuggestion('test/api-123')).toEqual(Option.some('test/api-123'))
  })

  it('refuses anything else', () => {
    for (const text of [
      '',
      'new-launcher',
      'feature/new-launcher',
      'perf/faster',
      'feat/New-Launcher',
      'feat/new_launcher',
      'feat/new--launcher',
      'feat/new-launcher-',
      'Branch: feat/new-launcher',
      'feat/new-launcher\nbecause it adds a launcher',
      'feat/x/y',
      `feat/${'very-long-'.repeat(5)}name`
    ]) {
      expect(parseSuggestion(text)).toEqual(Option.none())
    }
  })
})

describe('fallbackBranch', () => {
  it('is feat/ and the kebab case of the first words that fit', () => {
    expect(fallbackBranch('Add a launcher palette to Fleet')).toBe(
      'feat/add-a-launcher-palette-to-fleet'
    )
    expect(fallbackBranch('  Fix: the ÜBER-bug in naïve café!  ')).toBe(
      'feat/fix-the-uber-bug-in-naive-cafe'
    )
    expect(
      fallbackBranch('Rewrite the whole provisioning pipeline so it streams progress to Fleet')
    ).toBe('feat/rewrite-the-whole-provisioning')
  })

  it('always yields a valid branch within the limit', () => {
    for (const task of ['', '!!!', '日本語のタスク', 'x'.repeat(200), 'a b c', 'PROJ-123 do it']) {
      const branch = fallbackBranch(task)

      expect(branch.length).toBeLessThanOrEqual(fallbackLimit)
      expect(Option.isSome(branchToName(branch))).toBe(true)
    }

    expect(fallbackBranch('日本語のタスク')).toBe('feat/task')
  })
})

describe('suggestionPrompt', () => {
  it('states the rules and carries the task', () => {
    const prompt = suggestionPrompt('  Add a launcher  ')

    expect(prompt).toContain('feat/ fix/ chore/ docs/ refactor/ test/')
    expect(prompt).toContain('At most 40 characters')
    expect(prompt.endsWith('Task:\nAdd a launcher')).toBe(true)
  })
})
