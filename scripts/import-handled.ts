// `pnpm fleet:import-handled [--dry-run]`: one-off rollout of the attention model. Marks every
// root session whose latest run was already viewed in OpenCode as handled. Idempotent; run once
// at deploy, never automatically. Connects like the app: OPENCODE_URL / OPENCODE_PASSWORD, else
// discovery of the systemd-owned service (leave FLEET_SESSION_LIMIT unset so every session loads).

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import { Console, Effect } from 'effect'
import { importHandled } from '@/lib/data/fleet/import-handled'
import { OpenCodeLive } from '@/lib/services/opencode/live-layer'

const usage = 'Usage: pnpm fleet:import-handled [--dry-run]'

const args = process.argv.slice(2)

const program = args.every(arg => arg === '--dry-run')
  ? importHandled({ dryRun: args.includes('--dry-run') }).pipe(Effect.asVoid)
  : Effect.andThen(
      Console.error(usage),
      Effect.sync(() => {
        process.exitCode = 2
      })
    )

NodeRuntime.runMain(program.pipe(Effect.provide(OpenCodeLive)))
