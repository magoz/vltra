import { describe, expect, it } from '@effect/vitest'
import { diffSnapshots, initialChange } from '@/lib/data/vltra/change'
import { VltraEvent } from '@/lib/data/vltra/events'
import { applyEvent, fromSnapshot } from '@/lib/data/vltra/model'
import type { VltraModel } from '@/lib/data/vltra/model'
import { buildSnapshot } from '@/lib/data/vltra/snapshot'
import { quietAfter } from '@/lib/data/vltra/state'
import { baseTime, sessionRecord, webUrl } from '@/lib/data/vltra/testing/fixtures'
import type { VltraConnection } from '@/lib/data/vltra/types'
import { emptySnapshot } from '@/lib/services/opencode/testing/fake-opencode'

const connected: VltraConnection = { status: 'connected', since: baseTime, failures: 0 }

const project = (model: VltraModel, connection = connected) =>
  buildSnapshot(model, { connection, webUrl, now: baseTime })

const model = fromSnapshot(
  { ...emptySnapshot, sessions: [sessionRecord('ses_a'), sessionRecord('ses_b')] },
  baseTime
)

describe('vltra.changed diff', () => {
  it('sends every row the first time', () => {
    const change = diffSnapshots(undefined, project(model))

    expect(change?.rows.map(row => row.id).toSorted()).toEqual(['ses_a', 'ses_b'])
  })

  it('is empty when nothing a client renders changed', () => {
    expect(diffSnapshots(project(model), project(model))).toBeUndefined()
  })

  it('sends only the changed root row with fresh counts', () => {
    const next = applyEvent(model, VltraEvent.ExecutionStarted({ sessionID: 'ses_b', at: 1 }))
    const change = diffSnapshots(project(model), project(next))

    expect(change?.rows.map(row => [row.id, row.state])).toEqual([['ses_b', 'working']])
    expect(change?.removed).toEqual([])
    expect(change?.counts.working).toBe(1)
  })

  it('lists removed root rows', () => {
    const next = applyEvent(model, VltraEvent.SessionRemoved({ sessionID: 'ses_a' }))

    expect(diffSnapshots(project(model), project(next))?.removed).toEqual(['ses_a'])
  })

  it('reports connection changes even without row changes', () => {
    const change = diffSnapshots(
      project(model),
      project(model, { status: 'disconnected', since: baseTime + 1, failures: 1 })
    )

    expect(change?.connection.status).toBe('disconnected')
    expect(change?.rows).toEqual([])
  })

  it('reports count changes even without row changes (stuck changes with time)', () => {
    const working = applyEvent(
      model,
      VltraEvent.ExecutionStarted({ sessionID: 'ses_a', at: baseTime })
    )

    const before = buildSnapshot(working, { connection: connected, webUrl, now: baseTime })

    const quiet = buildSnapshot(working, {
      connection: connected,
      webUrl,
      now: baseTime + quietAfter
    })

    const change = diffSnapshots(before, quiet)

    expect(change?.rows).toEqual([])
    expect(change?.counts.stuck).toBe(1)
  })

  it('starts each stream with an initial, row-less change', () => {
    expect(initialChange(project(model))).toMatchObject({ initial: true, rows: [], removed: [] })
  })
})
