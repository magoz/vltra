import { Effect } from 'effect'
import { connection } from 'next/server'
import { FleetStore } from '@/lib/data/fleet/store'
import { fleetStatePriority } from '@/lib/data/fleet/types'
import type { FleetRow } from '@/lib/data/fleet/types'
import { runFleet } from '@/lib/runtime/fleet-runtime'

const rowLabel = (row: FleetRow) => row.title ?? row.id

/** Request-fresh fleet counts and a plain list of root sessions (stage 1 proof only). */
export async function FleetOverview() {
  await connection()

  const snapshot = await runFleet(
    Effect.flatMap(FleetStore, store => store.snapshot).pipe(Effect.withSpan('page.fleet.overview'))
  )

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        OpenCode: {snapshot.connection.status}
        {snapshot.connection.version === undefined ? '' : ` (v${snapshot.connection.version})`}
      </p>
      <dl className="flex flex-wrap gap-4 text-sm">
        {fleetStatePriority.map(state => (
          <div key={state} className="flex gap-1">
            <dt className="text-muted-foreground">{state}</dt>
            <dd className="font-medium tabular-nums">{snapshot.counts[state]}</dd>
          </div>
        ))}
      </dl>
      {snapshot.projects.length === 0 ? (
        <p className="text-muted-foreground text-sm">No sessions yet.</p>
      ) : (
        <ul className="space-y-3">
          {snapshot.projects.map(project => (
            <li key={project.id}>
              <p className="font-medium">{project.name}</p>
              <ul className="space-y-1 pl-4 text-sm">
                {project.worktrees.flatMap(worktree =>
                  worktree.rows.map(row => (
                    <li key={row.id}>
                      <span className="text-muted-foreground">{row.state}</span> ·{' '}
                      <a className="underline-offset-2 hover:underline" href={row.links.web}>
                        {rowLabel(row)}
                      </a>
                    </li>
                  ))
                )}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
