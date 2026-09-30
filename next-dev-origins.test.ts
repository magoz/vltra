// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { getAllowedDevOrigins } from './next-dev-origins'
import packageJson from './package.json'

const appName = packageJson.portless

describe('Next development origins', () => {
  it('preserves local project and worktree origins without a runtime URL', () => {
    expect(getAllowedDevOrigins()).toEqual([`${appName}.localhost`, `*.${appName}.localhost`])
  })

  it.each([`${appName}.dev.example.com`, `feature.${appName}.dev.example.com`])(
    'allows the exact injected hostname %s without a broad remote wildcard',
    hostname => {
      const origins = getAllowedDevOrigins(`https://${hostname}`)
      expect(origins).toContain(hostname)
      expect(origins).not.toContain('*.dev.example.com')
      expect(origins).not.toContain(`https://${hostname}`)
    }
  )

  it('extracts only the hostname when HTTP and a custom port are used', () => {
    expect(getAllowedDevOrigins(`http://${appName}.dev.example.com:1355`)).toContain(
      `${appName}.dev.example.com`
    )
  })

  it('does not duplicate existing local hostnames', () => {
    const hostname = `${appName}.localhost`
    expect(
      getAllowedDevOrigins(`https://${hostname}`).filter(origin => origin === hostname)
    ).toHaveLength(1)
  })

  it.each([
    '',
    'not-a-url',
    'file:///tmp/app',
    'https://*.example.com',
    'https://user:secret@example.com'
  ])('rejects invalid or unsafe runtime URLs without echoing them: case %#', value => {
    expect(() => getAllowedDevOrigins(value)).toThrow('Invalid PORTLESS_URL for dev origins')
  })
})
