import { describe, expect, it } from 'vitest'
import { fleetHref, moveTo, screenOf } from '@/app/fleet-href'
import type { FleetPlace } from '@/app/fleet-href'
import { StatsPeriod } from '@/lib/data/fleet/stats-period'

describe('fleet URLs', () => {
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
    expect(fleetHref('focus', {})).toBe('/')
    expect(fleetHref('agents', {})).toBe('/?view=agents')
    expect(fleetHref('projects', {})).toBe('/?view=projects')
  })

  it('keeps the open session on every tab and the filter on Agents and Board only', () => {
    expect(fleetHref('focus', { project: 'prj_fleet', session: 'ses_1' })).toBe(
      '/?project=prj_fleet&session=ses_1'
    )
    expect(fleetHref('agents', { project: 'prj_fleet', session: 'ses_1' })).toBe(
      '/?view=agents&project=prj_fleet&session=ses_1'
    )
    expect(fleetHref('projects', { project: 'prj_fleet', session: 'ses_1' })).toBe(
      '/?view=projects&session=ses_1'
    )
  })

  it('moves between tabs: the filter stays between Agents and Board, Projects has none', () => {
    const filtered: FleetPlace = { screen: 'focus', project: 'prj_fleet' }

    expect(moveTo(filtered, 'agents')).toEqual({ screen: 'agents', project: 'prj_fleet' })
    expect(moveTo(filtered, 'projects')).toEqual({ screen: 'projects', project: undefined })
    expect(moveTo(filtered, 'settings')).toEqual({ screen: 'settings', project: undefined })
    expect(fleetHref('settings', { project: 'prj_fleet' })).toBe('/?view=settings')
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

    expect(fleetHref('stats', { project: 'prj_fleet', period: days })).toBe(
      '/?view=stats&project=prj_fleet&from=2026-10-01&to=2026-10-03'
    )
    expect(fleetHref('stats', { period: StatsPeriod.Preset({ preset: '30d' }) })).toBe(
      '/?view=stats&range=30d'
    )
    expect(fleetHref('stats', { period: StatsPeriod.Preset({ preset: '7d' }) })).toBe(
      '/?view=stats'
    )
    expect(fleetHref('agents', { period: days })).toBe('/?view=agents')
    expect(moveTo({ screen: 'agents', project: 'prj_fleet' }, 'stats')).toEqual({
      screen: 'stats',
      project: 'prj_fleet'
    })
  })
})
