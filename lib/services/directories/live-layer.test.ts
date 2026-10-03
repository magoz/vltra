import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { DirectoriesLive } from '@/lib/services/directories/live-layer'
import { Directories } from '@/lib/services/directories/service'

// Real folders under a private temp directory.
const root = mkdtempSync(path.join(tmpdir(), 'fleet-directories-'))

const present = path.join(root, 'present')

const file = path.join(root, 'file')

const locked = path.join(root, 'locked')

mkdirSync(present)

mkdirSync(path.join(locked, 'inside'), { recursive: true })

writeFileSync(file, 'not a directory')

afterAll(() => {
  chmodSync(locked, 0o700)
  rmSync(root, { recursive: true, force: true })
})

const check = (directories: ReadonlyArray<string>) =>
  Effect.flatMap(Directories, service => service.check(directories)).pipe(
    Effect.provide(DirectoriesLive)
  )

describe('DirectoriesLive', () => {
  it.effect('reports missing and not-a-directory paths as gone, existing folders as present', () =>
    Effect.gen(function* () {
      const result = yield* check([
        present,
        path.join(root, 'deleted'),
        file,
        path.join(file, 'below-a-file'),
        present
      ])

      expect(Array.from(result)).toEqual([
        [present, false],
        [path.join(root, 'deleted'), true],
        [file, true],
        [path.join(file, 'below-a-file'), true]
      ])
    })
  )

  // Root can read anything, so there is no permission error to provoke.
  it.effect.skipIf(process.getuid?.() === 0)(
    'fails open: a folder it cannot inspect counts as present',
    () =>
      Effect.gen(function* () {
        chmodSync(locked, 0o000)

        const result = yield* check([path.join(locked, 'inside')])

        chmodSync(locked, 0o700)

        expect(result.get(path.join(locked, 'inside'))).toBe(false)
      })
  )
})
