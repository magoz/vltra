// `pnpm vltra:migrate-handled [--dry-run]`: one-off after the Fleet → Vltra rename. Moves every
// handled marker from `metadata.fleet` to `metadata.vltra`. Idempotent; run once at deploy, never
// automatically. Connects like the app: OPENCODE_URL / OPENCODE_PASSWORD, else discovery of the
// running service (leave VLTRA_SESSION_LIMIT unset so every session loads).

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import { Console, Effect } from 'effect'
import { migrateHandled } from '@/lib/data/vltra/migrate-handled'
import { OpenCodeLive } from '@/lib/services/opencode/live-layer'

const usage = 'Usage: pnpm vltra:migrate-handled [--dry-run]'

const args = process.argv.slice(2)

const program = args.every(arg => arg === '--dry-run')
  ? migrateHandled({ dryRun: args.includes('--dry-run') }).pipe(Effect.asVoid)
  : Effect.andThen(
      Console.error(usage),
      Effect.sync(() => {
        process.exitCode = 2
      })
    )

NodeRuntime.runMain(program.pipe(Effect.provide(OpenCodeLive)))
