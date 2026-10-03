import { describe, expect, it } from '@effect/vitest'
import { fuzzyScore, paletteItems, worktreeName } from '@/lib/data/fleet/palette'
import type { LauncherEntry, LauncherWorktree } from '@/lib/data/fleet/types'

const tally = { blocked: 0, working: 0, finished: 0, handled: 0 }

const worktree = (directory: string, branch: string | undefined): LauncherWorktree => ({
  directory,
  branch,
  owner: 'dotfiles',
  pr: { state: 'none' },
  sessions: tally
})

const entry = (name: string, worktrees: ReadonlyArray<LauncherWorktree> = []): LauncherEntry => ({
  name,
  directory: `/r/${name}`,
  sessions: tally,
  worktrees
})

const entries = [
  entry('fleet', [worktree('/r/fleet-feat-x', 'feat/x'), worktree('/r/fleet-d', undefined)]),
  entry('afloat'),
  entry('box', [worktree('/r/box-fix-tls', 'fix/tls')])
]

const keys = (query: string) => paletteItems(entries, query).map(item => item.key)

describe('fuzzyScore', () => {
  it('matches subsequences case-insensitively, else nothing', () => {
    expect(fuzzyScore('FLT', 'fleet')).toBeDefined()
    expect(fuzzyScore('tlf', 'fleet')).toBeUndefined()
    expect(fuzzyScore('', 'anything')).toBe(0)
  })

  it('prefers consecutive characters and word starts', () => {
    expect(fuzzyScore('fl', 'fleet')).toBeGreaterThan(fuzzyScore('fl', 'afloat') ?? 0)
    expect(fuzzyScore('fx', 'fleet feat/x')).toBeGreaterThan(fuzzyScore('fx', 'fleetfix') ?? 0)
  })
})

describe('paletteItems', () => {
  it('lists every repository followed by its worktrees, in launcher order', () => {
    expect(keys('')).toEqual([
      '/r/fleet',
      '/r/fleet-feat-x',
      '/r/fleet-d',
      '/r/afloat',
      '/r/box',
      '/r/box-fix-tls'
    ])
  })

  it('keeps only matches, best first; worktrees match by repo, branch and folder', () => {
    expect(keys('tls')).toEqual(['/r/box-fix-tls'])
    expect(keys('fl')[0]).toBe('/r/fleet')
    expect(keys('fleet x')).toContain('/r/fleet-feat-x')
    expect(keys('fleet-d')).toEqual(['/r/fleet-d'])
    expect(keys('zzz')).toEqual([])
  })

  it('names a detached worktree by its folder', () => {
    expect(worktreeName(worktree('/r/fleet-d', undefined))).toBe('fleet-d')
    expect(worktreeName(worktree('/r/fleet-feat-x', 'feat/x'))).toBe('feat/x')
  })
})
