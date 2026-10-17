import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StreamStatus } from '@/app/use-vltra-live'
import { useReloadOnDeploy } from '@/app/use-reload-on-deploy'
import { Toaster } from '@/components/ui/sonner'

/** The server answers `GET /api/vltra/version` with this build. */
const serve = (build: string) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify({ build }))))
  )

function Probe({
  stream,
  reload,
  typing = false
}: {
  readonly stream: StreamStatus
  readonly reload: () => void
  readonly typing?: boolean
}) {
  useReloadOnDeploy('build-1', stream, reload)

  return (
    <>
      {typing ? <textarea aria-label="Draft" autoFocus /> : null}
      <Toaster theme="light" />
    </>
  )
}

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state })
  fireEvent(document, new Event('visibilitychange'))
}

beforeEach(() => setVisibility('visible'))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('reload on deploy', () => {
  it('reloads once the stream is live and the server runs another build', async () => {
    serve('build-2')

    const reload = vi.fn()
    const view = render(<Probe stream="reconnecting" reload={reload} />)

    expect(fetch).not.toHaveBeenCalled()

    view.rerender(<Probe stream="live" reload={reload} />)

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    expect(vi.mocked(fetch).mock.calls.map(([input]) => String(input))).toEqual([
      '/api/vltra/version'
    ])
  })

  it('stays put on the same build', async () => {
    serve('build-1')

    const reload = vi.fn()

    render(<Probe stream="live" reload={reload} />)

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    await Promise.resolve()
    expect(reload).not.toHaveBeenCalled()
  })

  it('while typing, offers Reload and reloads when the page is hidden instead', async () => {
    serve('build-2')

    const reload = vi.fn()

    render(<Probe stream="live" reload={reload} typing />)

    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Draft' }))
    expect(await screen.findByText('Vltra was updated')).toBeTruthy()
    expect(reload).not.toHaveBeenCalled()

    setVisibility('hidden')

    expect(reload).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))

    expect(reload).toHaveBeenCalledTimes(2)
  })
})
