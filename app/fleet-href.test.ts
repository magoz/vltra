import { describe, expect, it } from 'vitest'
import { fleetHref, pageOf } from '@/app/fleet-href'

describe('fleet URLs', () => {
  it('reads the page from the path', () => {
    expect(pageOf('/')).toBe('agents')
    expect(pageOf('/projects')).toBe('projects')
    expect(pageOf('/projects/')).toBe('projects')
    expect(pageOf('/projectsx')).toBe('agents')
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
})
