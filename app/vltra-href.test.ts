import { describe, expect, it } from 'vitest'
import { vltraHref, moveTo, screenOf } from '@/app/vltra-href'
import type { VltraPlace } from '@/app/vltra-href'
import { StatsPeriod } from '@/lib/data/vltra/stats-period'

describe('vltra URLs', () => {
  it('reads the tab from ?view=: board or projects, else Agents (focus)', () => {
    expect(screenOf('agents')).toBe('agents')
    // The Agents tab's old name, for old links.
    expect(screenOf('board')).toBe('agents')
    expect(screenOf('projects')).toBe('projects')
    expect(screenOf('stats')).toBe('stats')
    expect(screenOf('settings')).toBe('settings')
    expect(screenOf(null)).toBe('focus')
    expect(screenOf('focus')).toBe('focus')
    expect(screenOf('kanban')).toBe('focus')
  })

  it('keeps every tab on the one page, Agents without a param', () => {
    expect(vltraHref('focus', {})).toBe('/')
    expect(vltraHref('agents', {})).toBe('/?view=agents')
    expect(vltraHref('projects', {})).toBe('/?view=projects')
  })

  it('keeps the open session on every tab and the filter on Agents and Board only', () => {
    expect(vltraHref('focus', { project: 'prj_vltra', session: 'ses_1' })).toBe(
      '/?project=prj_vltra&session=ses_1'
    )
    expect(vltraHref('agents', { project: 'prj_vltra', session: 'ses_1' })).toBe(
      '/?view=agents&project=prj_vltra&session=ses_1'
    )
    expect(vltraHref('projects', { project: 'prj_vltra', session: 'ses_1' })).toBe(
      '/?view=projects&session=ses_1'
    )
  })

  it('moves between tabs: the filter stays between Agents and Board, Projects has none', () => {
    const filtered: VltraPlace = { screen: 'focus', project: 'prj_vltra' }

    expect(moveTo(filtered, 'agents')).toEqual({ screen: 'agents', project: 'prj_vltra' })
    expect(moveTo(filtered, 'projects')).toEqual({ screen: 'projects', project: undefined })
    expect(moveTo(filtered, 'settings')).toEqual({ screen: 'settings', project: undefined })
    expect(vltraHref('settings', { project: 'prj_vltra' })).toBe('/?view=settings')
    expect(moveTo({ screen: 'projects', project: undefined }, 'agents')).toEqual({
      screen: 'agents',
      project: undefined
    })
    // A given filter wins (the Projects card headers open their board).
    expect(moveTo({ screen: 'projects', project: undefined }, 'agents', 'prj_box')).toEqual({
      screen: 'agents',
      project: 'prj_box'
    })
  })
  it("keeps Stats' range on Stats only, the default left out", () => {
    const days = StatsPeriod.Days({ from: '2026-10-01', to: '2026-10-03' })

    expect(vltraHref('stats', { project: 'prj_vltra', period: days })).toBe(
      '/?view=stats&project=prj_vltra&from=2026-10-01&to=2026-10-03'
    )
    expect(vltraHref('stats', { period: StatsPeriod.Preset({ preset: '30d' }) })).toBe(
      '/?view=stats&range=30d'
    )
    expect(vltraHref('stats', { period: StatsPeriod.Preset({ preset: '7d' }) })).toBe(
      '/?view=stats'
    )
    expect(vltraHref('agents', { period: days })).toBe('/?view=agents')
    expect(moveTo({ screen: 'agents', project: 'prj_vltra' }, 'stats')).toEqual({
      screen: 'stats',
      project: 'prj_vltra'
    })
  })
})
