import { snapshotRows } from '@/lib/data/vltra/snapshot'
import type { VltraChange, VltraRow, VltraSnapshot } from '@/lib/data/vltra/types'

// Rows are immutable once projected, and each snapshot is diffed twice (as `next`, then as
// `previous`): serialise every row once. With every session loaded this halves the diff.
const rowKeys = new WeakMap<VltraRow, string>()

const rowKey = (row: VltraRow) => {
  const known = rowKeys.get(row)

  if (known !== undefined) return known

  const key = JSON.stringify(row)

  rowKeys.set(row, key)

  return key
}

/**
 * The `vltra.changed` payload between two snapshots: root rows that were added or changed, root
 * rows that disappeared, and every launch when any changed. Undefined when nothing a client
 * renders changed (counts included: `stuck` changes with time alone).
 */
export const diffSnapshots = (
  previous: VltraSnapshot | undefined,
  next: VltraSnapshot
): VltraChange | undefined => {
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

  const countsChanged =
    previous === undefined || JSON.stringify(previous.counts) !== JSON.stringify(next.counts)

  const launchesChanged =
    previous === undefined || JSON.stringify(previous.launches) !== JSON.stringify(next.launches)

  if (
    rows.length === 0 &&
    removed.length === 0 &&
    !connectionChanged &&
    !countsChanged &&
    !launchesChanged
  ) {
    return undefined
  }

  return {
    initial: false,
    connection: next.connection,
    counts: next.counts,
    rows,
    removed,
    launches: launchesChanged ? next.launches : undefined
  }
}

/** The first event of every SSE stream: current counts, connection and launches, no rows. */
export const initialChange = (snapshot: VltraSnapshot): VltraChange => ({
  initial: true,
  connection: snapshot.connection,
  counts: snapshot.counts,
  rows: [],
  removed: [],
  launches: snapshot.launches
})
