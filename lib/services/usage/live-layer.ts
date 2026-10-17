import { Config, Duration, Effect, Layer, Schema } from 'effect'
import { Usage, UsageUnavailableError } from '@/lib/services/usage/service'
import type { QuotaAccount } from '@/lib/services/usage/service'

/** The usage dashboard's base URL (`VLTRA_USAGE_URL`), on loopback by default. */
export const usageUrl = Config.string('VLTRA_USAGE_URL').pipe(
  Config.withDefault('http://127.0.0.1:8320')
)

const requestTimeout = Duration.seconds(10)

/** The part of `GET /api/usage` Vltra reads. */
const UsageResponse = Schema.Struct({
  accounts: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      provider: Schema.String,
      providerName: Schema.String,
      account: Schema.String,
      status: Schema.String,
      windows: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          label: Schema.String,
          remainingPercent: Schema.Number,
          durationMinutes: Schema.optional(Schema.NullOr(Schema.Number)),
          resetsAt: Schema.NullOr(Schema.String)
        })
      )
    })
  ),
  /** Which accounts the proxy routes to; absent from dashboards older than it, or unknown. */
  routing: Schema.optional(
    Schema.Struct({
      status: Schema.String,
      accounts: Schema.optional(Schema.Array(Schema.Struct({ accountId: Schema.String })))
    })
  )
})

type UsageResponse = typeof UsageResponse.Type

const decodeResponse = Schema.decodeUnknownEffect(Schema.fromJsonString(UsageResponse))

const resetTime = (value: string | null) => {
  const time = value === null ? Number.NaN : Date.parse(value)

  return Number.isFinite(time) ? time : undefined
}

const activeIds = (routing: UsageResponse['routing']) =>
  new Set(
    routing?.status === 'available' ? (routing.accounts ?? []).map(entry => entry.accountId) : []
  )

export const toAccounts = (response: UsageResponse): ReadonlyArray<QuotaAccount> => {
  const active = activeIds(response.routing)

  return response.accounts.map(account => ({
    provider: account.provider,
    providerName: account.providerName,
    account: account.account,
    fresh: account.status === 'fresh',
    active: active.has(account.id),
    windows: account.windows.map(window => ({
      id: window.id,
      label: window.label,
      remainingPercent: window.remainingPercent,
      durationMinutes: window.durationMinutes ?? undefined,
      resetsAt: resetTime(window.resetsAt)
    }))
  }))
}

const unavailable = (message: string) => () => new UsageUnavailableError({ message })

/** Reads `<base>/api/usage` on every call. */
export const makeUsage = (base: string) =>
  Usage.of({
    accounts: Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: signal => fetch(new URL('/api/usage', base), { signal, cache: 'no-store' }),
        catch: unavailable('usage dashboard unreachable')
      })

      if (!response.ok) return yield* unavailable(`usage dashboard answered ${response.status}`)()

      const text = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: unavailable('usage dashboard answer cut short')
      })

      return toAccounts(
        yield* decodeResponse(text).pipe(
          Effect.mapError(unavailable('usage dashboard answer unreadable'))
        )
      )
    }).pipe(
      Effect.timeoutOrElse({
        duration: requestTimeout,
        orElse: () =>
          Effect.fail(new UsageUnavailableError({ message: 'usage dashboard timed out' }))
      })
    )
  })

export const UsageLive = Layer.effect(Usage, Effect.map(usageUrl, makeUsage)).pipe(Layer.orDie)
