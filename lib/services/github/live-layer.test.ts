import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as NodeChildProcessSpawner from '@effect/platform-node/NodeChildProcessSpawner'
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem'
import * as NodePath from '@effect/platform-node/NodePath'
import { afterAll, describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { makeGitHub } from '@/lib/services/github/live-layer'
import { GitHub } from '@/lib/services/github/service'

const base = mkdtempSync(path.join(tmpdir(), 'vltra-github-'))

const bin = path.join(base, 'bin')

const log = path.join(base, 'gh.log')

const pull = (number: number, mergedAt: string) =>
  JSON.stringify({
    number,
    createdAt: '2026-09-30T23:00:00Z',
    mergedAt,
    repository: { nameWithOwner: 'magoz/vltra' }
  })

const page = (count: number, nodes: ReadonlyArray<string>, next?: string) =>
  `{"data":{"search":{"issueCount":${count},"pageInfo":{"hasNextPage":${next !== undefined},"endCursor":${next === undefined ? 'null' : `"${next}"`}},"nodes":[${nodes.join(',')}]}}}`

// The fake `gh` logs `first cursor q` for every call and answers by the query's window: the whole
// two days count past the search's cap (so they are read in halves), the first half in two pages.
mkdirSync(bin)

writeFileSync(
  path.join(bin, 'gh'),
  `#!/bin/sh
if [ "$GH_FAKE" = "signed-out" ]; then exit 4; fi
q=""; cursor=""; first=""
for arg in "$@"; do
  case "$arg" in
    q=*) q="\${arg#q=}" ;;
    cursor=*) cursor="\${arg#cursor=}" ;;
    first=*) first="\${arg#first=}" ;;
  esac
done
echo "$first $cursor $q" >> ${JSON.stringify(log)}
case "$q" in
  *merged:2026-10-01T00:00:00Z..2026-10-02T23:59:59Z) echo '${page(1500, [])}' ;;
  *merged:2026-10-01T00:00:00Z..*)
    if [ "$cursor" = "c1" ]; then echo '${page(2, [pull(2, '2026-10-01T20:00:00Z')])}';
    else echo '${page(2, [pull(1, '2026-10-01T10:00:00Z')], 'c1')}'; fi ;;
  *merged:2026-10-02T00:00:00Z..*) echo '${page(1, [pull(3, '2026-10-02T05:00:00Z')])}' ;;
  *) echo '{"message":"Bad request"}'; exit 1 ;;
esac
`
)

chmodSync(path.join(bin, 'gh'), 0o755)

afterAll(() => rmSync(base, { recursive: true, force: true }))

const githubLayer = (extra: Readonly<Record<string, string>> = {}) =>
  Layer.effect(
    GitHub,
    makeGitHub({ env: { PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`, ...extra } })
  ).pipe(
    Layer.provide(NodeChildProcessSpawner.layer),
    Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))
  )

const calls = () =>
  readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .filter(line => line !== '')

const twoDays = { from: Date.UTC(2026, 9, 1), to: Date.UTC(2026, 9, 3) }

describe('GitHubLive', () => {
  it.live('reads every page, in halves past the search cap', () =>
    Effect.gen(function* () {
      writeFileSync(log, '')

      const pulls = yield* Effect.flatMap(GitHub, github => github.merged(twoDays))

      expect(pulls.map(entry => entry.number)).toEqual([1, 2, 3])
      expect(pulls[0]).toEqual({
        repo: 'magoz/vltra',
        number: 1,
        createdAt: Date.UTC(2026, 8, 30, 23),
        mergedAt: Date.UTC(2026, 9, 1, 10)
      })

      // The whole window (too many), then the first half's two pages and the second half's one.
      expect(calls().map(line => line.split(' ').slice(0, 2).join(' '))).toEqual([
        '100 ',
        '100 ',
        '100 c1',
        '100 '
      ])
    }).pipe(Effect.provide(githubLayer()))
  )

  it.live('counts with one small call', () =>
    Effect.gen(function* () {
      writeFileSync(log, '')

      expect(yield* Effect.flatMap(GitHub, github => github.mergedCount(twoDays))).toBe(1500)
      expect(calls().map(line => line.split(' ')[0])).toEqual(['1'])
    }).pipe(Effect.provide(githubLayer()))
  )

  it.live('fails with why: signed out, or GitHub’s own message', () =>
    Effect.gen(function* () {
      const signedOut = yield* Effect.flip(
        Effect.flatMap(GitHub, github => github.merged(twoDays)).pipe(
          Effect.provide(githubLayer({ GH_FAKE: 'signed-out' }))
        )
      )

      expect(signedOut.message).toBe('gh is not signed in')

      const refused = yield* Effect.flip(
        Effect.flatMap(GitHub, github =>
          github.merged({ from: Date.UTC(2026, 0, 1), to: Date.UTC(2026, 0, 2) })
        ).pipe(Effect.provide(githubLayer()))
      )

      expect(refused.message).toBe('GitHub: Bad request')
    })
  )
})
