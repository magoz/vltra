'use client'

import { Option, Schema } from 'effect'
import { useEffect, useState } from 'react'
import { statsPeriodParams } from '@/lib/data/fleet/stats-period'
import type { StatsPeriod } from '@/lib/data/fleet/stats-period'
import { PromptsByProject, StatsCalendar, StatsHours, StatsReport } from '@/lib/data/fleet/types'

const decodeReport = Schema.decodeUnknownOption(Schema.fromJsonString(StatsReport))

const decodeHours = Schema.decodeUnknownOption(Schema.fromJsonString(StatsHours))

const decodeCalendar = Schema.decodeUnknownOption(Schema.fromJsonString(StatsCalendar))

const decodeProjects = Schema.decodeUnknownOption(Schema.fromJsonString(PromptsByProject))

const decodeFailure = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ error: Schema.String }))
)

/** Recent buckets keep changing while agents work; settled ones are cached on the server. */
const refreshEvery = 60_000

/**
 * One of the Stats tab's reads: loading or failed (each with the last value shown, perhaps for
 * another range, to keep on screen meanwhile), or ready.
 */
export type StatsState<A> =
  | { readonly status: 'loading'; readonly last: A | undefined }
  | { readonly status: 'ready'; readonly value: A }
  | { readonly status: 'failed'; readonly error: string; readonly last: A | undefined }

/** The value to show: the current one, else the last. */
export const shownValue = <A>(state: StatsState<A>): A | undefined =>
  state.status === 'ready' ? state.value : state.last

/** The browser's time zone, which the report's days and hours follow. */
export const browserTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone

/** The Stats routes' query for a range, an OpenCode project (or all) and a time zone. */
const statsQuery = (period: StatsPeriod, project: string | undefined, timeZone: string) => {
  const params = new URLSearchParams()

  for (const [name, value] of statsPeriodParams(period)) params.set(name, value)

  params.set('tz', timeZone)

  if (project !== undefined) params.set('project', project)

  return params.toString()
}

/** `GET /api/fleet/stats`'s URL. */
export const statsUrl = (period: StatsPeriod, project: string | undefined, timeZone: string) =>
  `/api/fleet/stats?${statsQuery(period, project, timeZone)}`

/** `GET /api/fleet/stats/projects`'s URL (prompts per bar by project; every project). */
export const statsProjectsUrl = (period: StatsPeriod, timeZone: string) =>
  `/api/fleet/stats/projects?${statsQuery(period, undefined, timeZone)}`

/** `GET /api/fleet/stats/calendar`'s URL (a year of days; the range does not matter). */
export const statsCalendarUrl = (project: string | undefined, timeZone: string) => {
  const params = new URLSearchParams({ tz: timeZone })

  if (project !== undefined) params.set('project', project)

  return `/api/fleet/stats/calendar?${params.toString()}`
}

/** `GET /api/fleet/stats/hours`'s URL (prompts per hour). */
export const statsHoursUrl = (period: StatsPeriod, project: string | undefined, timeZone: string) =>
  `/api/fleet/stats/hours?${statsQuery(period, project, timeZone)}`

type Settled<A> = Exclude<StatsState<A>, { readonly status: 'loading' }>

/** The latest answer and the URL it answered. */
type Fetched<A> = { readonly url: string; readonly state: Settled<A> }

const lastOf = <A>(state: Settled<A>) => (state.status === 'ready' ? state.value : state.last)

/**
 * Loads `url` on mount and whenever it changes, then every minute while the page shows and when it
 * shows again. Until the URL's first answer it is loading, showing the last value; a failed
 * refresh keeps the last value on screen too.
 */
function useStatsRead<A>(url: string, decode: (text: string) => Option.Option<A>): StatsState<A> {
  const [fetched, setFetched] = useState<Fetched<A>>()

  useEffect(() => {
    let controller = new AbortController()

    const settle = (next: (last: A | undefined) => Settled<A>) =>
      setFetched(previous => ({
        url,
        state: next(previous === undefined ? undefined : lastOf(previous.state))
      }))

    const load = () => {
      if (document.visibilityState !== 'visible') return

      controller.abort()
      controller = new AbortController()

      fetch(url, { cache: 'no-store', signal: controller.signal })
        .then(async response => {
          const text = await response.text()

          if (response.ok) {
            const value = decode(text)

            settle(last =>
              Option.match(value, {
                onNone: () => ({ status: 'failed', error: 'Unexpected stats', last }),
                onSome: decoded => ({ status: 'ready', value: decoded })
              })
            )

            return
          }

          const error = Option.match(decodeFailure(text), {
            onNone: () => `Stats failed (${response.status})`,
            onSome: body => body.error
          })

          settle(last => ({ status: 'failed', error, last }))
        })
        .catch(() => {
          if (controller.signal.aborted) return

          settle(last => ({ status: 'failed', error: 'Fleet is not reachable', last }))
        })
    }

    load()

    const timer = setInterval(load, refreshEvery)

    document.addEventListener('visibilitychange', load)

    return () => {
      controller.abort()
      clearInterval(timer)
      document.removeEventListener('visibilitychange', load)
    }
  }, [url, decode])

  if (fetched === undefined) return { status: 'loading', last: undefined }

  return fetched.url === url ? fetched.state : { status: 'loading', last: lastOf(fetched.state) }
}

/** The Stats report (`GET /api/fleet/stats`). */
export const useStats = (url: string): StatsState<StatsReport> => useStatsRead(url, decodeReport)

/**
 * Prompts per hour (`GET /api/fleet/stats/hours`), read apart from the report: up to 31 days of
 * hours can take OpenCode a while the first time.
 */
export const useStatsHours = (url: string): StatsState<StatsHours> => useStatsRead(url, decodeHours)

/**
 * Prompts per bar by project (`GET /api/fleet/stats/projects`), read apart from the report: one
 * call per project and per bar of the top five the first time.
 */
export const useStatsProjects = (url: string): StatsState<PromptsByProject> =>
  useStatsRead(url, decodeProjects)

/** Steps per day over the last year (`GET /api/fleet/stats/calendar`), read apart from the report. */
export const useStatsCalendar = (url: string): StatsState<StatsCalendar> =>
  useStatsRead(url, decodeCalendar)
