import { describe, expect, it } from '@effect/vitest'
import { fuzzyScore, paletteItems, worktreeName } from '@/lib/data/vltra/palette'
import type { LauncherEntry, LauncherWorktree } from '@/lib/data/vltra/types'

const tally = { blocked: 0, working: 0, finished: 0, handled: 0 }

const worktree = (directory: string, branch: string | undefined): LauncherWorktree => ({
  directory,
  branch,
  owner: 'dotfiles',
  pr: { state: 'none' },
  sessions: tally
})

const entry = (name: string, worktrees: ReadonlyArray<LauncherWorktree> = []): LauncherEntry => ({
  kind: 'repo',
  name,
  directory: `/r/${name}`,
  sessions: tally,
  worktrees
})

const entries = [
  entry('float', [worktree('/r/float-feat-x', 'feat/x'), worktree('/r/float-d', undefined)]),
  entry('afloat'),
  entry('box', [worktree('/r/box-fix-tls', 'fix/tls')])
]

const keys = (query: string) => paletteItems(entries, query).map(item => item.key)

describe('fuzzyScore', () => {
  it('matches subsequences case-insensitively, else nothing', () => {
    expect(fuzzyScore('FLT', 'float')).toBeDefined()
    expect(fuzzyScore('tlf', 'float')).toBeUndefined()
    expect(fuzzyScore('', 'anything')).toBe(0)
  })

  it('prefers consecutive characters and word starts', () => {
    expect(fuzzyScore('fl', 'float')).toBeGreaterThan(fuzzyScore('fl', 'afloat') ?? 0)
    expect(fuzzyScore('fx', 'float feat/x')).toBeGreaterThan(fuzzyScore('fx', 'floatfix') ?? 0)
  })
})

describe('paletteItems', () => {
  it('lists every repository followed by its worktrees, in launcher order', () => {
    expect(keys('')).toEqual([
      '/r/float',
      '/r/float-feat-x',
      '/r/float-d',
      '/r/afloat',
      '/r/box',
      '/r/box-fix-tls'
    ])
  })

  it('keeps only matches, best first; worktrees match by repo, branch and folder', () => {
    expect(keys('tls')).toEqual(['/r/box-fix-tls'])
    expect(keys('fl')[0]).toBe('/r/float')
    expect(keys('float x')).toContain('/r/float-feat-x')
    expect(keys('float-d')).toEqual(['/r/float-d'])
    expect(keys('zzz')).toEqual([])
  })

  it('names a detached worktree by its folder', () => {
    expect(worktreeName(worktree('/r/float-d', undefined))).toBe('float-d')
    expect(worktreeName(worktree('/r/float-feat-x', 'feat/x'))).toBe('feat/x')
  })
})
