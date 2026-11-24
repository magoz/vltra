import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { formatWakeTime } from '@/app/snooze-time'
import { useWakeTime } from '@/app/use-wake-time'

function Probe() {
  const [time, save] = useWakeTime()

  return (
    <>
      <output>{formatWakeTime(time)}</output>
      <button type="button" onClick={() => save({ hours: 7, minutes: 30 })}>
        early
      </button>
    </>
  )
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('wake time (Settings)', () => {
  it('is 09:00 until one is saved; a saved one is kept in this browser and shown everywhere', () => {
    render(
      <>
        <Probe />
        <Probe />
      </>
    )

    expect(screen.getAllByRole('status').map(item => item.textContent)).toEqual(['09:00', '09:00'])

    fireEvent.click(screen.getAllByRole('button', { name: 'early' })[0] ?? document.body)

    expect(screen.getAllByRole('status').map(item => item.textContent)).toEqual(['07:30', '07:30'])
    expect(window.localStorage.getItem('vltra.snooze.wakeTime')).toBe('07:30')
  })

  it('a malformed stored value reads as the default', () => {
    window.localStorage.setItem('vltra.snooze.wakeTime', 'noon')

    render(<Probe />)

    expect(screen.getByRole('status').textContent).toBe('09:00')
  })
})
