import { describe, expect, it } from 'vitest'
import { fleetHref, pageOf, viewOf } from '@/app/fleet-href'

describe('fleet URLs', () => {
  it('reads the page from the path', () => {
    expect(pageOf('/')).toBe('agents')
    expect(pageOf('/projects')).toBe('projects')
    expect(pageOf('/projects/')).toBe('projects')
    expect(pageOf('/projectsx')).toBe('agents')
  })

  it('reads the Agents mode: board when asked, else focus', () => {
    expect(viewOf('board')).toBe('board')
    expect(viewOf(null)).toBe('focus')
    expect(viewOf('focus')).toBe('focus')
    expect(viewOf('kanban')).toBe('focus')
  })

  it('keeps the open session on both pages and the filter on Agents only', () => {
    expect(fleetHref('agents', {})).toBe('/')
    expect(fleetHref('agents', { project: 'prj_fleet', session: 'ses_1' })).toBe(
      '/?project=prj_fleet&session=ses_1'
    )
    expect(fleetHref('projects', { project: 'prj_fleet', session: 'ses_1' })).toBe(
      '/projects?session=ses_1'
    )
    expect(fleetHref('projects', {})).toBe('/projects')
  })

  it('writes the board mode on both pages and leaves focus (the default) out', () => {
    expect(fleetHref('agents', { view: 'focus', project: 'prj_fleet' })).toBe('/?project=prj_fleet')
    expect(fleetHref('agents', { view: 'board', project: 'prj_fleet', session: 'ses_1' })).toBe(
      '/?view=board&project=prj_fleet&session=ses_1'
    )
    expect(fleetHref('projects', { view: 'board', project: 'prj_fleet' })).toBe(
      '/projects?view=board'
    )
  })
})
