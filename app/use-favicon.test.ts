import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { faviconStatus, faviconSvg, useFavicon } from '@/app/use-favicon'
import type { VltraCounts } from '@/lib/data/vltra/types'

const none: VltraCounts = { blocked: 0, finished: 0, working: 0, stuck: 0, handled: 3 }

afterEach(() => {
  cleanup()
  document.head.innerHTML = ''
})

describe('faviconStatus', () => {
  it('needs you when a session is blocked or finished, even with others working', () => {
    expect(faviconStatus({ ...none, blocked: 1, working: 2 })).toBe('needs-you')
    expect(faviconStatus({ ...none, finished: 1 })).toBe('needs-you')
  })

  it('working when sessions work and none needs you', () => {
    expect(faviconStatus({ ...none, working: 2, stuck: 1 })).toBe('working')
  })

  it('idle otherwise', () => {
    expect(faviconStatus(none)).toBe('idle')
  })
})

describe('faviconSvg', () => {
  it('is app/icon.svg when idle', () => {
    expect(faviconSvg('idle')).toBe(readFileSync(join(__dirname, 'icon.svg'), 'utf8'))
  })
})

describe('useFavicon', () => {
  it('points the icon link at the current status and follows it', () => {
    const link = document.createElement('link')
    link.rel = 'icon'
    link.href = '/icon.svg'
    document.head.append(link)

    const { rerender } = renderHook(({ counts }) => useFavicon(counts), {
      initialProps: { counts: { ...none, working: 1 } }
    })

    expect(decodeURIComponent(link.href)).toBe(`data:image/svg+xml,${faviconSvg('working')}`)

    rerender({ counts: { ...none, finished: 1 } })

    expect(decodeURIComponent(link.href)).toBe(`data:image/svg+xml,${faviconSvg('needs-you')}`)
  })
})
