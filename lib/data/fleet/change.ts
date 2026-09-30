import { snapshotRows } from '@/lib/data/fleet/snapshot'
import type { FleetChange, FleetRow, FleetSnapshot } from '@/lib/data/fleet/types'

const rowKey = (row: FleetRow) => JSON.stringify(row)

/**
 * The `fleet.changed` payload between two snapshots: root rows that were added or changed, and
 * root rows that disappeared. Undefined when nothing a client renders changed.
 */
export const diffSnapshots = (
  previous: FleetSnapshot | undefined,
  next: FleetSnapshot
): FleetChange | undefined => {
  const before = new Map(
    (previous === undefined ? [] : snapshotRows(previous)).map(row => [row.id, rowKey(row)])
  )

  const after = snapshotRows(next)
  const afterIds = new Set(after.map(row => row.id))
  const rows = after.filter(row => before.get(row.id) !== rowKey(row))
  const removed = Array.from(before.keys()).filter(id => !afterIds.has(id))

  const connectionChanged =
    previous === undefined ||
    JSON.stringify(previous.connection) !== JSON.stringify(next.connection)

  if (rows.length === 0 && removed.length === 0 && !connectionChanged) return undefined

  return { initial: false, connection: next.connection, counts: next.counts, rows, removed }
}

/** The first event of every SSE stream: current counts and connection, no rows. */
export const initialChange = (snapshot: FleetSnapshot): FleetChange => ({
  initial: true,
  connection: snapshot.connection,
  counts: snapshot.counts,
  rows: [],
  removed: []
})
