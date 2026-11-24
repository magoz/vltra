import { describe, expect, it } from '@effect/vitest'
import { VltraEvent } from '@/lib/data/vltra/events'
import { applyEvent, fromSnapshot } from '@/lib/data/vltra/model'
import type { OpenCodeSnapshot, VltraModel } from '@/lib/data/vltra/model'
import { buildRows } from '@/lib/data/vltra/snapshot'
import {
  canMarkDone,
  countRows,
  isStuck,
  quietAfter,
  servicesOf,
  waitingOn
} from '@/lib/data/vltra/state'
import {
  baseTime,
  runningShell,
  runningWatch,
  sessionRecord,
  webUrl
} from '@/lib/data/vltra/testing/fixtures'
import type { RunningShell, RunningWatch, VltraRow } from '@/lib/data/vltra/types'
import { emptySnapshot } from '@/lib/services/opencode/testing/fake-opencode'

// A run that ends while something will wake its agent (a background script, an `until` watch)
// is waiting, so it works rather than needing me.

const minute = 60 * 1000

const shell = (id: string, sessionID: string, fields: Partial<RunningShell> = {}) =>
  runningShell(id, sessionID, { started: baseTime - 4 * minute, ...fields })

const ended = (id: string, fields: Parameters<typeof sessionRecord>[1] = {}) =>
  sessionRecord(id, { idle: baseTime, outcome: 'succeeded', ...fields })

/** A snapshot, then the `until` watches the watcher reads after it. */
const modelOf = ({
  watches = [],
  ...snapshot
}: Partial<OpenCodeSnapshot> & { readonly watches?: ReadonlyArray<RunningWatch> }): VltraModel =>
  applyEvent(
    fromSnapshot({ ...emptySnapshot, ...snapshot }, baseTime),
    VltraEvent.WatchesLoaded({ watches })
  )

const rowOf = (model: VltraModel, id: string): VltraRow => {
  const row = buildRows(model, webUrl).find(item => item.id === id)

  if (row === undefined) throw new Error(`no row ${id}`)

  return row
}

const ids = (row: VltraRow) => waitingOn(row).map(wait => wait.id)

describe('background scripts', () => {
  it('keep a run that ended working, as waits', () => {
    const row = rowOf(
      modelOf({ sessions: [ended('ses_1')], shells: [shell('sh_1', 'ses_1')] }),
      'ses_1'
    )

    expect(row).toMatchObject({ state: 'working', running: false, services: [] })
    expect(row.waits).toEqual([
      { kind: 'script', id: 'sh_1', command: 'pnpm test', started: baseTime - 4 * minute }
    ])
    expect(waitingOn(row)).toEqual(row.waits)
    expect(canMarkDone(row)).toBe(true)
  })

  it('finish the run once the last script ends', () => {
    const waiting = modelOf({
      sessions: [ended('ses_1')],
      shells: [shell('sh_2', 'ses_1', { started: baseTime - minute }), shell('sh_1', 'ses_1')]
    })

    expect(ids(rowOf(waiting, 'ses_1'))).toEqual(['sh_1', 'sh_2'])

    const one = applyEvent(waiting, VltraEvent.ShellEnded({ shellID: 'sh_1' }))

    expect(rowOf(one, 'ses_1').state).toBe('working')

    const none = applyEvent(one, VltraEvent.ShellEnded({ shellID: 'sh_2' }))

    expect(rowOf(none, 'ses_1').state).toBe('finished')
    expect(waitingOn(rowOf(none, 'ses_1'))).toEqual([])
  })

  it('a started script holds back the run that ends after it', () => {
    const running = modelOf({ sessions: [sessionRecord('ses_1')], running: ['ses_1'] })

    const model = [
      VltraEvent.ShellStarted({ shell: shell('sh_1', 'ses_1') }),
      VltraEvent.ExecutionEnded({
        sessionID: 'ses_1',
        at: baseTime + 1,
        outcome: 'succeeded',
        reason: undefined
      })
    ].reduce(applyEvent, running)

    expect(rowOf(model, 'ses_1').state).toBe('working')
  })

  it('say nothing while the run itself is active (its own activity shows)', () => {
    const model = modelOf({
      sessions: [sessionRecord('ses_1')],
      running: ['ses_1'],
      shells: [shell('sh_1', 'ses_1')]
    })

    expect(waitingOn(rowOf(model, 'ses_1'))).toEqual([])
  })

  it('never make a handled run need me again, nor bring it back to working', () => {
    const model = modelOf({
      sessions: [ended('ses_1', { handled: baseTime })],
      shells: [shell('sh_1', 'ses_1')]
    })

    expect(rowOf(model, 'ses_1').state).toBe('handled')
  })

  it("a subagent's script keeps its parent working", () => {
    const model = modelOf({
      sessions: [ended('ses_root'), ended('ses_child', { parentID: 'ses_root' })],
      shells: [shell('sh_1', 'ses_child', { command: 'gh run watch 42' })]
    })

    const row = rowOf(model, 'ses_root')

    expect(row).toMatchObject({ ownState: 'finished', state: 'working' })
    expect(ids(row)).toEqual(['sh_1'])
  })

  it('a long wait is not stuck: nothing is quiet, it is waiting', () => {
    const model = modelOf({ sessions: [ended('ses_1')], shells: [shell('sh_1', 'ses_1')] })
    const now = baseTime + 3 * quietAfter

    expect(isStuck(rowOf(model, 'ses_1'), now)).toBe(false)
    expect(countRows(buildRows(model, webUrl), now)).toMatchObject({ working: 1, stuck: 0 })
  })

  it('leave with their session', () => {
    const model = applyEvent(
      modelOf({
        sessions: [ended('ses_1')],
        shells: [shell('sh_1', 'ses_1')],
        watches: [runningWatch('w_1', 'ses_1')]
      }),
      VltraEvent.SessionRemoved({ sessionID: 'ses_1' })
    )

    expect(model.shells.size).toBe(0)
    expect(model.watches.size).toBe(0)
  })

  it('Done applies to a run that waits, never to an active run or an ask', () => {
    const running = modelOf({
      sessions: [sessionRecord('ses_1')],
      running: ['ses_1'],
      shells: [shell('sh_1', 'ses_1')]
    })

    const asking = modelOf({
      sessions: [ended('ses_1')],
      shells: [shell('sh_1', 'ses_1')],
      permissions: [{ id: 'per_1', sessionID: 'ses_1', action: 'bash', resources: [] }]
    })

    expect(canMarkDone(rowOf(running, 'ses_1'))).toBe(false)
    expect(canMarkDone(rowOf(asking, 'ses_1'))).toBe(false)
  })

  it("Done on the root releases a subagent's script too", () => {
    const model = modelOf({
      sessions: [
        ended('ses_root', { handled: baseTime }),
        ended('ses_child', { parentID: 'ses_root' })
      ],
      shells: [shell('sh_1', 'ses_child')]
    })

    expect(rowOf(model, 'ses_root').state).toBe('handled')
  })
})

describe('services (shells listening on a port)', () => {
  const waiting = modelOf({
    sessions: [ended('ses_1')],
    shells: [shell('sh_dev', 'ses_1', { command: 'pnpm dev' }), shell('sh_test', 'ses_1')]
  })

  it('are no waits: only the scripts hold the run', () => {
    const checked = applyEvent(
      waiting,
      VltraEvent.ShellsChecked({
        ports: new Map([
          ['sh_dev', [3000]],
          ['sh_test', []]
        ])
      })
    )

    const row = rowOf(checked, 'ses_1')

    expect(row.state).toBe('working')
    expect(ids(row)).toEqual(['sh_test'])
    expect(servicesOf(row)).toEqual([{ id: 'sh_dev', command: 'pnpm dev', ports: [3000] }])

    const served = rowOf(
      applyEvent(checked, VltraEvent.ShellEnded({ shellID: 'sh_test' })),
      'ses_1'
    )

    expect(served.state).toBe('finished')
    expect(servicesOf(served).map(service => service.command)).toEqual(['pnpm dev'])
  })

  it('keep their ports until checked again, and leave with their shell', () => {
    const first = applyEvent(
      waiting,
      VltraEvent.ShellsChecked({ ports: new Map([['sh_dev', [3000]]]) })
    )

    const second = applyEvent(
      first,
      VltraEvent.ShellsChecked({ ports: new Map([['sh_test', []]]) })
    )

    expect(second.shellPorts).toEqual(
      new Map([
        ['sh_dev', [3000]],
        ['sh_test', []]
      ])
    )

    const gone = applyEvent(second, VltraEvent.ShellEnded({ shellID: 'sh_dev' }))

    expect(Array.from(gone.shellPorts.keys())).toEqual(['sh_test'])
  })

  it('a looked-up process id fills a known shell, never brings back an ended one', () => {
    const found = applyEvent(waiting, VltraEvent.ShellProcessFound({ shellID: 'sh_dev', pid: 42 }))

    expect(found.shells.get('sh_dev')?.pid).toBe(42)
    expect(applyEvent(waiting, VltraEvent.ShellProcessFound({ shellID: 'sh_x', pid: 7 }))).toBe(
      waiting
    )
  })
})

describe('until watches', () => {
  const ci = runningWatch('w_ci', 'ses_1', {
    label: 'PR 288 CI',
    started: baseTime - 12 * minute,
    nextAt: baseTime + 20_000,
    expiresAt: baseTime + 60 * minute
  })

  it('keep a run that ended working, as waits with their label and times', () => {
    const row = rowOf(modelOf({ sessions: [ended('ses_1')], watches: [ci] }), 'ses_1')

    expect(row.state).toBe('working')
    expect(row.waits).toEqual([
      {
        kind: 'watch',
        id: 'w_ci',
        label: 'PR 288 CI',
        recurring: false,
        started: baseTime - 12 * minute,
        nextAt: baseTime + 20_000,
        expiresAt: baseTime + 60 * minute
      }
    ])
    expect(canMarkDone(row)).toBe(true)
  })

  it("follow `changed`: the session's waits replace its old ones; none finishes the run", () => {
    const model = modelOf({ sessions: [ended('ses_1')], watches: [ci] })

    const replaced = applyEvent(
      model,
      VltraEvent.WatchesChanged({
        sessionID: 'ses_1',
        watches: [runningWatch('w_sync', 'ses_1', { recurring: true })]
      })
    )

    expect(ids(rowOf(replaced, 'ses_1'))).toEqual(['w_sync'])

    const none = applyEvent(
      replaced,
      VltraEvent.WatchesChanged({ sessionID: 'ses_1', watches: [] })
    )

    expect(rowOf(none, 'ses_1').state).toBe('finished')
    expect(none.watches.has('ses_1')).toBe(false)
  })

  it('wait alongside scripts, oldest first', () => {
    const model = modelOf({
      sessions: [ended('ses_1')],
      shells: [shell('sh_1', 'ses_1')],
      watches: [ci]
    })

    expect(ids(rowOf(model, 'ses_1'))).toEqual(['w_ci', 'sh_1'])
  })

  it('a location read twice lists each watch once', () => {
    const model = modelOf({ sessions: [ended('ses_1')], watches: [ci, ci] })

    expect(model.watches.get('ses_1')).toEqual([ci])
  })

  it('never hold a handled run', () => {
    const model = modelOf({ sessions: [ended('ses_1', { handled: baseTime })], watches: [ci] })

    expect(rowOf(model, 'ses_1').state).toBe('handled')
  })
})
