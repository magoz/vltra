import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bucketTitle } from '@/app/stats-format'
import { fakeActions, TestDashboard, testLocation } from '@/app/testing/dashboard-fixtures'
import type { NavCall } from '@/app/testing/dashboard-fixtures'
import { fleetLive, now } from '@/app/testing/fleet-scenario'
import { noActivity } from '@/lib/data/fleet/stats'
import { HoursRead, HoursTooLong } from '@/lib/data/fleet/types'
import type { PromptsByProject, StatsHours, StatsReport } from '@/lib/data/fleet/types'

const day = 24 * 60 * 60 * 1000

const report: StatsReport = {
  from: now - 2 * day,
  to: now,
  unit: 'day',
  timezone: 'UTC',
  totals: {
    ...noActivity(now - 2 * day, now),
    sessions: 12,
    subagents: 30,
    prompts: 806,
    steps: 15_661,
    tokens: { input: 1000, output: 11_000, reasoning: 0, cacheRead: 4_000_000, cacheWrite: 0 },
    activeDays: 2,
    streak: 2,
    toolTotals: { calls: 200, succeeded: 180, failed: 20, unfinished: 0 },
    tools: [
      { name: 'shell', calls: 150, succeeded: 140, failed: 10, unfinished: 0, durationP50: 45 }
    ],
    models: [
      {
        model: 'anthropic/claude#high',
        steps: 15_661,
        tokens: { input: 1000, output: 11_000, reasoning: 0, cacheRead: 4_000_000, cacheWrite: 0 }
      }
    ]
  },
  buckets: [0, 1].map(index => ({
    start: now - (2 - index) * day,
    end: now - (1 - index) * day,
    sessions: 6,
    subagents: 15,
    prompts: 403,
    steps: 7830,
    tokens: { input: 500, output: 5500, reasoning: 0, cacheRead: 2_000_000, cacheWrite: 0 },
    tools: { calls: 100, succeeded: 90, failed: 10, unfinished: 0 },
    models: []
  }))
}

/** Prompts on Tuesdays 14:00 UTC, 7 of them. */
const hours: StatsHours = HoursRead.make({
  from: report.from,
  to: report.to,
  timezone: 'UTC',
  hours: [{ start: Date.UTC(2026, 9, 6, 14), prompts: 7 }]
})

/** Prompts per day by project: fleet and box, the rest unlisted. */
const projects: PromptsByProject = {
  from: report.from,
  to: report.to,
  unit: 'day',
  timezone: 'UTC',
  buckets: report.buckets.map(bucket => ({
    start: bucket.start,
    end: bucket.end,
    prompts: bucket.prompts
  })),
  projects: [
    { projectID: 'prj_fleet', prompts: [300, 200] },
    { projectID: 'prj_box', prompts: [100, 3] }
  ]
}

/**
 * Answers `/api/fleet/stats` with `answer` and `.../hours` with `hoursAnswer`; everything else
 * (usage, launcher) is not found.
 */
const statsFetch = (answer: () => Response, hoursAnswer = () => Response.json(hours)) =>
  vi.fn((input: RequestInfo | URL) => {
    const url = String(input)

    if (url.startsWith('/api/fleet/stats/hours')) return Promise.resolve(hoursAnswer())

    if (url.startsWith('/api/fleet/stats/projects')) return Promise.resolve(Response.json(projects))

    return Promise.resolve(
      url.startsWith('/api/fleet/stats?') ? answer() : new Response('{}', { status: 404 })
    )
  })

const statsUrls = (fetch: ReturnType<typeof statsFetch>) =>
  fetch.mock.calls
    .map(([input]) => String(input))
    .filter(url => url.startsWith('/api/fleet/stats?'))

const renderStats = () => {
  const navigations: Array<NavCall> = []

  render(
    <TestDashboard
      live={fleetLive()}
      now={now}
      actions={fakeActions().actions}
      screen="stats"
      navigations={navigations}
    />
  )

  return { navigations }
}

/** Recharts measures its container, and jsdom has no layout: every chart is 600 × 200. */
class FixedResizeObserver {
  readonly #callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback
  }

  observe(target: Element) {
    const contentRect = DOMRectReadOnly.fromRect({ width: 600, height: 200 })

    const entry: ResizeObserverEntry = {
      target,
      contentRect,
      borderBoxSize: [],
      contentBoxSize: [],
      devicePixelContentBoxSize: []
    }

    this.#callback([entry], this)
  }

  unobserve() {}

  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FixedResizeObserver)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('stats tab', () => {
  it("loads the last 7 days in the browser's zone and shows the headline numbers", async () => {
    const fetch = statsFetch(() => Response.json(report))

    vi.stubGlobal('fetch', fetch)
    renderStats()

    const steps = await screen.findByText('Steps', { selector: 'dt' })

    expect(steps.nextElementSibling?.textContent).toBe('15.7K')
    expect(statsUrls(fetch)[0]).toMatch(/^\/api\/fleet\/stats\?tz=[\w%/]+$/)
    expect(screen.getByText('806')).toBeTruthy()
    expect(screen.getByText('10% failed')).toBeTruthy()
    expect(screen.getByRole('status', { name: 'Range shown' }).textContent).toBe(
      'Sep 21 – Sep 23 · by day'
    )

    const models = screen.getByRole('table', { name: 'Model' })

    expect(within(models).getByText('anthropic/claude#high')).toBeTruthy()
    expect(within(screen.getByRole('table', { name: 'Tool' })).getByText('45ms')).toBeTruthy()
  })

  it('switches the range in place: a preset, the [ ] keys, then custom days', async () => {
    const fetch = statsFetch(() => Response.json(report))

    vi.stubGlobal('fetch', fetch)

    const { navigations } = renderStats()

    fireEvent.click(await screen.findByRole('button', { name: '30d' }))

    expect(testLocation()).toBe('/?view=stats&range=30d')
    await waitFor(() => expect(statsUrls(fetch).at(-1)).toContain('range=30d'))

    fireEvent.keyDown(document.body, { key: ']' })
    expect(testLocation()).toBe('/?view=stats&range=90d')

    fireEvent.click(screen.getByRole('button', { name: 'Custom' }))
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-01' } })

    expect(navigations.at(-1)).toMatchObject({ kind: 'period' })
    expect(testLocation()).toMatch(/^\/\?view=stats&from=2026-09-01&to=\d{4}-\d{2}-\d{2}$/)

    // Back to another tab drops the range.
    fireEvent.keyDown(document.body, { key: '2' })
    expect(testLocation()).toBe('/?view=agents')
  })

  it("asks OpenCode for the filter's project", async () => {
    const fetch = statsFetch(() => Response.json(report))

    vi.stubGlobal('fetch', fetch)
    renderStats()

    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'prj_fleet' } })

    await waitFor(() => expect(statsUrls(fetch).at(-1)).toContain('project=prj_fleet'))
    expect(testLocation()).toBe('/?view=stats&project=prj_fleet')
  })

  it("says why it has nothing to show when OpenCode's stats fail", async () => {
    vi.stubGlobal(
      'fetch',
      statsFetch(() => Response.json({ error: 'OpenCode is not reachable' }, { status: 503 }))
    )
    renderStats()

    expect(await screen.findByText('OpenCode is not reachable')).toBeTruthy()
  })

  it('shows prompts by weekday and hour, else sessions started past 31 days', async () => {
    vi.stubGlobal(
      'fetch',
      statsFetch(() => Response.json(report))
    )
    renderStats()

    const prompts = await screen.findByRole('table', { name: 'prompts by weekday and hour' })

    expect(within(prompts).getByLabelText('Tue 14:00: 7')).toBeTruthy()
    expect(within(prompts).getByLabelText('Mon 14:00: 0')).toBeTruthy()

    cleanup()
    vi.stubGlobal(
      'fetch',
      statsFetch(
        () => Response.json(report),
        () => Response.json(HoursTooLong.make({}))
      )
    )
    renderStats()

    expect(
      await screen.findByRole('table', { name: 'sessions started by weekday and hour' })
    ).toBeTruthy()
  })

  it('splits the Prompts bars by project, with the same projects in Sessions started', async () => {
    vi.stubGlobal(
      'fetch',
      statsFetch(() => Response.json(report))
    )
    renderStats()

    const prompts = await screen.findByRole('region', { name: 'Prompts' })
    const legend = await within(prompts).findByRole('list', { name: 'Legend' })

    expect(
      within(legend)
        .getAllByRole('listitem')
        .map(item => item.textContent)
    ).toEqual(['fleet', 'box', 'rest'])

    const sessions = screen.getByRole('region', { name: 'Sessions started' })

    expect(
      within(within(sessions).getByRole('list', { name: 'Legend' }))
        .getAllByRole('listitem')
        .map(item => item.textContent)
        .slice(0, 2)
    ).toEqual(['fleet', 'box'])
  })

  it('shows a heatmap cell on hover', async () => {
    vi.stubGlobal(
      'fetch',
      statsFetch(() => Response.json(report))
    )
    renderStats()

    const prompts = await screen.findByRole('table', { name: 'prompts by weekday and hour' })

    fireEvent.mouseOver(within(prompts).getByLabelText('Tue 14:00: 7'))

    expect(screen.getByRole('tooltip').textContent).toBe('Tue 14:00–15:00 · 7 prompts')

    fireEvent.mouseLeave(prompts.parentElement ?? prompts)

    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it("names a tile's bar and value on hover", async () => {
    vi.stubGlobal(
      'fetch',
      statsFetch(() => Response.json(report))
    )
    renderStats()

    const steps = await screen.findByText('Steps', { selector: 'dt' })
    const tile = steps.parentElement ?? steps
    const line = tile.querySelector('svg')?.parentElement

    if (line === null || line === undefined) return expect.unreachable('a sparkline')

    // jsdom has no layout: every box is at 0 and 0 wide, so the pointer picks the first bar.
    fireEvent.mouseMove(line, { clientX: 0 })

    expect(within(tile).getByRole('tooltip').textContent).toBe(
      `${bucketTitle(report.buckets[0]?.start ?? 0, 'day', 'UTC')} · 7.8K`
    )

    fireEvent.mouseLeave(line)

    expect(within(tile).queryByRole('tooltip')).toBeNull()
  })
})
