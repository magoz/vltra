import { describe, expect, it } from '@effect/vitest'
import { VltraEvent } from '@/lib/data/vltra/events'
import { applyEvent, fromSnapshot } from '@/lib/data/vltra/model'
import type { OpenCodeSnapshot, VltraModel } from '@/lib/data/vltra/model'
import { buildRows } from '@/lib/data/vltra/snapshot'
import { countRows, isStuck, quietAfter, waitingShells } from '@/lib/data/vltra/state'
import { baseTime, sessionRecord, webUrl } from '@/lib/data/vltra/testing/fixtures'
import type { RunningShell, VltraRow } from '@/lib/data/vltra/types'
import { emptySnapshot } from '@/lib/services/opencode/testing/fake-opencode'

// A run that ends while a shell it started in the background still runs is waiting on that
// script (OpenCode wakes the agent when it exits), so it works rather than needing me.

const minute = 60 * 1000

const shell = (
  id: string,
  sessionID: string,
  fields: Partial<RunningShell> = {}
): RunningShell => ({
  id,
  sessionID,
  command: 'pnpm test',
  started: baseTime - 4 * minute,
  ...fields
})

const ended = (id: string, fields: Parameters<typeof sessionRecord>[1] = {}) =>
  sessionRecord(id, { idle: baseTime, outcome: 'succeeded', ...fields })

const modelOf = (snapshot: Partial<OpenCodeSnapshot>): VltraModel =>
  fromSnapshot({ ...emptySnapshot, ...snapshot }, baseTime)

const rowOf = (model: VltraModel, id: string): VltraRow => {
  const row = buildRows(model, webUrl).find(item => item.id === id)

  if (row === undefined) throw new Error(`no row ${id}`)

  return row
}

describe('background scripts', () => {
  it('keep a run that ended working, and say what it waits on', () => {
    const model = modelOf({ sessions: [ended('ses_1')], shells: [shell('sh_1', 'ses_1')] })
    const row = rowOf(model, 'ses_1')

    expect(row).toMatchObject({ state: 'working', running: false })
    expect(row.shells).toEqual([
      { id: 'sh_1', command: 'pnpm test', started: baseTime - 4 * minute }
    ])
    expect(waitingShells(row)).toEqual(row.shells)
  })

  it('finish the run once the last script ends', () => {
    const waiting = modelOf({
      sessions: [ended('ses_1')],
      shells: [shell('sh_2', 'ses_1', { started: baseTime - minute }), shell('sh_1', 'ses_1')]
    })

    // Oldest first.
    expect(waitingShells(rowOf(waiting, 'ses_1')).map(item => item.id)).toEqual(['sh_1', 'sh_2'])

    const one = applyEvent(waiting, VltraEvent.ShellEnded({ shellID: 'sh_1' }))

    expect(rowOf(one, 'ses_1').state).toBe('working')

    const none = applyEvent(one, VltraEvent.ShellEnded({ shellID: 'sh_2' }))

    expect(rowOf(none, 'ses_1').state).toBe('finished')
    expect(waitingShells(rowOf(none, 'ses_1'))).toEqual([])
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

    expect(waitingShells(rowOf(model, 'ses_1'))).toEqual([])
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
    expect(waitingShells(row).map(item => item.command)).toEqual(['gh run watch 42'])
  })

  it('a long script is not stuck: nothing is quiet, it is waiting', () => {
    const model = modelOf({ sessions: [ended('ses_1')], shells: [shell('sh_1', 'ses_1')] })
    const now = baseTime + 3 * quietAfter

    expect(isStuck(rowOf(model, 'ses_1'), now)).toBe(false)
    expect(countRows(buildRows(model, webUrl), now)).toMatchObject({ working: 1, stuck: 0 })
  })

  it('leave with their session', () => {
    const model = applyEvent(
      modelOf({ sessions: [ended('ses_1')], shells: [shell('sh_1', 'ses_1')] }),
      VltraEvent.SessionRemoved({ sessionID: 'ses_1' })
    )

    expect(model.shells.size).toBe(0)
  })
})
