import { stat } from 'node:fs/promises'
import { Effect, Layer, Option, Schema } from 'effect'
import { Directories } from '@/lib/services/directories/service'

/** The part of a Node `fs` error Fleet reads. */
const ErrnoError = Schema.Struct({ code: Schema.String })

const decodeErrno = Schema.decodeUnknownOption(ErrnoError)

/** Codes that mean the path cannot be a directory any more. */
const goneCodes: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR'])

const errnoCode = (cause: unknown) =>
  Option.match(decodeErrno(cause), { onNone: () => 'unknown', onSome: error => error.code })

const isGone = (directory: string) =>
  Effect.tryPromise({ try: () => stat(directory), catch: errnoCode }).pipe(
    Effect.map(stats => !stats.isDirectory()),
    Effect.catch(code =>
      goneCodes.has(code)
        ? Effect.succeed(true)
        : // Fail open: an unreadable folder may still exist, and gone means handled.
          Effect.logDebug('Directory check failed; treating it as present', directory, code).pipe(
            Effect.as(false)
          )
    )
  )

/** Stats are cheap and local; a few at a time keeps a large fleet from flooding the disk. */
const concurrency = 16

export const DirectoriesLive = Layer.succeed(Directories, {
  check: directories =>
    Effect.forEach(
      Array.from(new Set(directories)),
      directory => Effect.map(isGone(directory), gone => [directory, gone] as const),
      { concurrency }
    ).pipe(Effect.map(entries => new Map(entries)))
})
