import { describe, expect, it } from 'vitest'
import { fleetHref, moveTo, screenOf } from '@/app/fleet-href'
import type { FleetPlace } from '@/app/fleet-href'

describe('fleet URLs', () => {
  it('reads the tab from ?view=: board or projects, else Agents (focus)', () => {
    expect(screenOf('board')).toBe('board')
    expect(screenOf('projects')).toBe('projects')
    expect(screenOf(null)).toBe('focus')
    expect(screenOf('focus')).toBe('focus')
    expect(screenOf('kanban')).toBe('focus')
  })

  it('keeps every tab on the one page, Agents without a param', () => {
    expect(fleetHref('focus', {})).toBe('/')
    expect(fleetHref('board', {})).toBe('/?view=board')
    expect(fleetHref('projects', {})).toBe('/?view=projects')
  })

  it('keeps the open session on every tab and the filter on Agents and Board only', () => {
    expect(fleetHref('focus', { project: 'prj_fleet', session: 'ses_1' })).toBe(
      '/?project=prj_fleet&session=ses_1'
    )
    expect(fleetHref('board', { project: 'prj_fleet', session: 'ses_1' })).toBe(
      '/?view=board&project=prj_fleet&session=ses_1'
    )
    expect(fleetHref('projects', { project: 'prj_fleet', session: 'ses_1' })).toBe(
      '/?view=projects&session=ses_1'
    )
  })

  it('moves between tabs: the filter stays between Agents and Board, Projects has none', () => {
    const filtered: FleetPlace = { screen: 'focus', project: 'prj_fleet' }

    expect(moveTo(filtered, 'board')).toEqual({ screen: 'board', project: 'prj_fleet' })
    expect(moveTo(filtered, 'projects')).toEqual({ screen: 'projects', project: undefined })
    expect(moveTo({ screen: 'projects', project: undefined }, 'board')).toEqual({
      screen: 'board',
      project: undefined
    })
    // A given filter wins (the Projects card headers open their board).
    expect(moveTo({ screen: 'projects', project: undefined }, 'board', 'prj_box')).toEqual({
      screen: 'board',
      project: 'prj_box'
    })
  })
})
