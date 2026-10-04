import { describe, expect, it } from 'vitest'
import { fleetHref, moveTo, screenOf } from '@/app/fleet-href'
import type { FleetPlace } from '@/app/fleet-href'

describe('fleet URLs', () => {
  it('reads the tab from ?view=: board or projects, else Agents (focus)', () => {
    expect(screenOf('agents')).toBe('agents')
    // The Agents tab's old name, for old links.
    expect(screenOf('board')).toBe('agents')
    expect(screenOf('projects')).toBe('projects')
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
})
