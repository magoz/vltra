import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as NodeChildProcessSpawner from '@effect/platform-node/NodeChildProcessSpawner'
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem'
import * as NodePath from '@effect/platform-node/NodePath'
import { afterAll, describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Option } from 'effect'
import { launcherRoots, parseWorktreeList } from '@/lib/services/repos/git'
import { makeRepos } from '@/lib/services/repos/live-layer'
import type { ReposOptions } from '@/lib/services/repos/live-layer'
import { Repos } from '@/lib/services/repos/service'

// Real git repositories with linked worktrees under a private temp directory, and a fake `gh`
// first on PATH. Nothing here touches a real repository or GitHub.

const base = realpathSync(mkdtempSync(path.join(tmpdir(), 'fleet-repos-')))

const root = path.join(base, 'repos')

const bin = path.join(base, 'bin')

const ghLog = path.join(base, 'gh.log')

const git = (cwd: string, ...args: ReadonlyArray<string>) =>
  execFileSync('git', ['-c', 'user.name=Fleet', '-c', 'user.email=fleet@example.com', ...args], {
    cwd,
    stdio: 'pipe',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
  }).toString()

const makeRepo = (directory: string) => {
  mkdirSync(directory, { recursive: true })
  git(directory, 'init', '-q', '-b', 'main')
  git(directory, 'commit', '-q', '--allow-empty', '-m', 'init')
}

const addWorktree = (repo: string, directory: string, branch: string | undefined) =>
  branch === undefined
    ? git(repo, 'worktree', 'add', '-q', '--detach', directory)
    : git(repo, 'worktree', 'add', '-q', '-b', branch, directory)

const writeMarker = (worktree: string, branch: string) => {
  const gitDir = git(worktree, 'rev-parse', '--absolute-git-dir').trim()

  writeFileSync(
    path.join(gitDir, 'dotfiles-worktree'),
    JSON.stringify({ strategy: 'dotfiles', branch, createdAt: '2026-10-03T00:00:00.000Z' })
  )
}

const alpha = path.join(root, 'alpha')

const beta = path.join(root, 'beta')

const owned = path.join(root, 'alpha-feat-x')

const plain = path.join(base, 'elsewhere', 'alpha-fix-y')

const stale = path.join(base, 'elsewhere', 'alpha-stale')

const detached = path.join(base, 'elsewhere', 'alpha-detached')

const solo = path.join(base, 'solo')

const extra = path.join(base, 'extra')

/** Repositories, worktrees (two ownership markers) and the fake `gh`, created once. */
const createFixture = () => {
  makeRepo(alpha)
  makeRepo(beta)
  makeRepo(path.join(root, '.hidden'))
  makeRepo(solo)
  makeRepo(extra)
  mkdirSync(path.join(root, 'notes'))
  writeFileSync(path.join(root, 'README'), 'not a folder')
  addWorktree(alpha, owned, 'feat/x')
  addWorktree(alpha, plain, 'fix/y')
  addWorktree(alpha, stale, 'feat/stale')
  addWorktree(alpha, detached, undefined)
  writeMarker(owned, 'feat/x')
  writeMarker(stale, 'feat/renamed')

  // The fake `gh` logs every call and answers per `--head` branch.
  mkdirSync(bin)
  writeFileSync(
    path.join(bin, 'gh'),
    `#!/bin/sh
echo "$PWD $*" >> ${JSON.stringify(ghLog)}
branch=""
while [ $# -gt 0 ]; do
  if [ "$1" = "--head" ]; then branch="$2"; fi
  shift
done
case "$branch" in
  feat/x) echo '[{"number":12,"state":"MERGED","url":"https://github.com/o/alpha/pull/12","closingIssuesReferences":[{"id":"I_1","number":9,"url":"https://github.com/o/alpha/issues/9","repository":{"name":"alpha"}}]}]' ;;
  fix/y) echo '[]' ;;
  slow/z) sleep 1; echo '[{"number":7,"state":"OPEN","url":"https://github.com/o/alpha/pull/7"}]' ;;
  *) echo 'HTTP 502' >&2; exit 1 ;;
esac
`
  )
  chmodSync(path.join(bin, 'gh'), 0o755)
}

createFixture()

afterAll(() => rmSync(base, { recursive: true, force: true }))

const options: ReposOptions = {
  roots: [root, solo, path.join(base, 'missing'), owned],
  env: { PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}` },
  prWait: '3 seconds'
}

const reposLayer = (overrides: Partial<ReposOptions> = {}) =>
  Layer.effect(Repos, makeRepos({ ...options, ...overrides })).pipe(
    Layer.provide(NodeChildProcessSpawner.layer),
    Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))
  )

const ghCalls = () => readFileSync(ghLog, 'utf8').trim().split('\n').length

describe('ReposLive', () => {
  it.live('lists the repositories under the roots with their linked worktrees and owners', () =>
    Effect.gen(function* () {
      const repos = yield* Effect.flatMap(Repos, service =>
        service.list([extra, path.join(base, 'nowhere'), 'relative/path', alpha])
      )

      // Children of a folder root, a repository root, extras; never linked worktrees on their own
      // (`alpha-feat-x` in the root), hidden folders, non-repositories or missing roots.
      expect(repos.map(repo => repo.name)).toEqual(['alpha', 'beta', 'solo', 'extra'])

      const [first] = repos

      expect(first?.directory).toBe(alpha)
      // By directory.
      expect(first?.worktrees).toEqual([
        { directory: detached, branch: undefined, owner: 'other' },
        { directory: plain, branch: 'fix/y', owner: 'other' },
        // The marker names another branch: not owned.
        { directory: stale, branch: 'feat/stale', owner: 'other' },
        { directory: owned, branch: 'feat/x', owner: 'dotfiles' }
      ])
      expect(repos[1]?.worktrees).toEqual([])
    }).pipe(Effect.provide(reposLayer()))
  )

  it.live('inspects one checkout', () =>
    Effect.gen(function* () {
      const repos = yield* Repos

      expect(yield* repos.inspect(owned)).toEqual(
        Option.some({
          directory: owned,
          primary: alpha,
          linked: true,
          branch: 'feat/x',
          owner: 'dotfiles'
        })
      )
      expect(yield* repos.inspect(plain)).toEqual(
        Option.some({
          directory: plain,
          primary: alpha,
          linked: true,
          branch: 'fix/y',
          owner: 'other'
        })
      )
      expect(yield* repos.inspect(alpha)).toEqual(
        Option.some({
          directory: alpha,
          primary: alpha,
          linked: false,
          branch: 'main',
          owner: 'other'
        })
      )
      expect(Option.map(yield* repos.inspect(detached), info => info.branch)).toEqual(
        Option.some(undefined)
      )

      // Not a checkout's top level, not a repository, gone, relative.
      for (const directory of [
        path.join(root, 'notes'),
        path.join(base, 'nowhere'),
        'alpha',
        path.join(alpha, '.git')
      ]) {
        expect(yield* repos.inspect(directory)).toEqual(Option.none())
      }
    }).pipe(Effect.provide(reposLayer()))
  )

  it.live('looks up pull requests with gh, cached; failures are unknown, no PR is none', () =>
    Effect.gen(function* () {
      const repos = yield* Repos

      writeFileSync(ghLog, '')

      expect(yield* repos.pullRequest({ repo: alpha, branch: 'feat/x' })).toEqual({
        state: 'merged',
        number: 12,
        url: 'https://github.com/o/alpha/pull/12',
        issues: [{ number: 9, url: 'https://github.com/o/alpha/issues/9' }]
      })
      expect(yield* repos.pullRequest({ repo: alpha, branch: 'fix/y' })).toEqual({ state: 'none' })
      expect(yield* repos.pullRequest({ repo: alpha, branch: 'feat/broken' })).toEqual({
        state: 'unknown'
      })

      // Run in the repository, exactly as specified.
      expect(readFileSync(ghLog, 'utf8').split('\n')[0]).toBe(
        `${alpha} pr list --head feat/x --state all --json number,state,url,closingIssuesReferences --limit 1`
      )

      const calls = ghCalls()

      yield* repos.pullRequest({ repo: alpha, branch: 'feat/x' })
      yield* repos.pullRequest({ repo: alpha, branch: 'feat/broken' })
      expect(ghCalls()).toBe(calls)
    }).pipe(Effect.provide(reposLayer()))
  )

  it.live('answers unknown while a lookup is slow, and caches its answer once it lands', () =>
    Effect.gen(function* () {
      const repos = yield* Repos

      expect(yield* repos.pullRequest({ repo: alpha, branch: 'slow/z' })).toEqual({
        state: 'unknown'
      })

      yield* Effect.sleep('1500 millis')

      expect(yield* repos.pullRequest({ repo: alpha, branch: 'slow/z' })).toEqual({
        state: 'open',
        number: 7,
        url: 'https://github.com/o/alpha/pull/7'
      })
    }).pipe(Effect.provide(reposLayer({ prWait: '100 millis' })))
  )

  it.live('looks up again once the cached answer expired', () =>
    Effect.gen(function* () {
      const repos = yield* Repos

      writeFileSync(ghLog, '')

      yield* repos.pullRequest({ repo: alpha, branch: 'fix/y' })
      yield* Effect.sleep('300 millis')
      yield* repos.pullRequest({ repo: alpha, branch: 'fix/y' })

      expect(ghCalls()).toBe(2)
    }).pipe(Effect.provide(reposLayer({ prTtl: '200 millis' })))
  )
})

describe('parseWorktreeList', () => {
  it('reads porcelain -z records: primary first, branches, detached, bare, prunable', () => {
    const output = [
      'worktree /r\0HEAD a\0branch refs/heads/main\0',
      'worktree /r-x\0HEAD b\0branch refs/heads/feat/x\0locked\0',
      'worktree /r-d\0HEAD c\0detached\0prunable gitdir file points to non-existent location\0',
      'worktree /bare\0bare\0',
      ''
    ].join('\0')

    expect(parseWorktreeList(output)).toEqual([
      { directory: '/r', branch: 'main', bare: false, prunable: false },
      { directory: '/r-x', branch: 'feat/x', bare: false, prunable: false },
      { directory: '/r-d', branch: undefined, bare: false, prunable: true },
      { directory: '/bare', branch: undefined, bare: true, prunable: false }
    ])
  })
})

describe('launcherRoots', () => {
  it('defaults to the sessionizer roots under the home directory', () => {
    expect(launcherRoots(Option.none(), '/home/me')).toEqual([
      '/home/me/dev/repos',
      '/home/me/.dotfiles',
      '/home/me/aha',
      '/home/me/collie',
      '/home/me/subs'
    ])
  })

  it('reads FLEET_LAUNCHER_ROOTS as a path list, expanding ~ and dropping relative entries', () => {
    expect(launcherRoots(Option.some('~/code: /srv/repos ::relative:~'), '/home/me')).toEqual([
      '/home/me/code',
      '/srv/repos',
      '/home/me'
    ])
  })
})
