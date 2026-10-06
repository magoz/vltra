import { Effect } from 'effect'
import type { UsagePool, UsageReading, UsageSummary } from '@/lib/data/fleet/types'
import { Usage } from '@/lib/services/usage/service'
import type { QuotaAccount, QuotaWindow } from '@/lib/services/usage/service'

/** Pools in this order (the rest after, as reported), with the header's short names. */
const knownProviders: ReadonlyArray<{ readonly provider: string; readonly name: string }> = [
  { provider: 'anthropic', name: 'Claude' },
  { provider: 'codex', name: 'Codex' },
  { provider: 'opencode-go', name: 'Go' }
]

/** A weekly limit on one model only: it never stops the account, so it never drives `left`. */
const isModelScoped = (window: QuotaWindow) => window.id.startsWith('weekly-scoped-')

/** The account's tightest window: the least left of those that bind the whole account. */
const tightest = (account: QuotaAccount) => {
  const binding = account.windows.filter(window => !isModelScoped(window))

  return binding.length === 0
    ? undefined
    : Math.min(...binding.map(window => window.remainingPercent))
}

const week = 7 * 24 * 60

/** The first weekly reset among the accounts, model-scoped weeks aside. */
const firstWeeklyReset = (accounts: ReadonlyArray<QuotaAccount>) => {
  const resets = accounts.flatMap(account =>
    account.windows.flatMap(window =>
      window.durationMinutes === week && !isModelScoped(window) && window.resetsAt !== undefined
        ? [window.resetsAt]
        : []
    )
  )

  return resets.length === 0 ? undefined : Math.min(...resets)
}

/** Each account adds its own 100%: the proxy moves on to the next one when one runs out. */
const pooled = (values: ReadonlyArray<number>): UsageReading | undefined =>
  values.length === 0
    ? undefined
    : {
        left: values.reduce((sum, value) => sum + value, 0),
        capacity: values.length * 100
      }

const providerRank = (provider: string) => {
  const rank = knownProviders.findIndex(known => known.provider === provider)

  return rank === -1 ? knownProviders.length : rank
}

const toPool = (accounts: ReadonlyArray<QuotaAccount>, provider: string): UsagePool => {
  const name =
    knownProviders.find(known => known.provider === provider)?.name ??
    accounts[0]?.providerName ??
    provider

  const reading = pooled(
    accounts.flatMap(account => {
      const value = tightest(account)

      return value === undefined ? [] : [value]
    })
  )

  return {
    provider,
    name,
    reading,
    weeklyResetAt: firstWeeklyReset(accounts),
    stale: accounts.some(account => !account.fresh),
    windows: accounts.flatMap(account =>
      account.windows.map(window => ({
        account: account.account,
        label: window.label,
        left: window.remainingPercent,
        resetsAt: window.resetsAt
      }))
    )
  }
}

/**
 * One pool per provider, Claude, Codex and Go first: how much is left of the window that
 * runs out first (summed over the pool's accounts, out of 100% each), the first weekly reset, and
 * every window for the details.
 */
export const usageSummary = (accounts: ReadonlyArray<QuotaAccount>): UsageSummary => {
  const providers = Array.from(new Set(accounts.map(account => account.provider))).toSorted(
    (left, right) => providerRank(left) - providerRank(right)
  )

  return {
    pools: providers.map(provider =>
      toPool(
        accounts.filter(account => account.provider === provider),
        provider
      )
    )
  }
}

/** The usage dashboard's accounts as Fleet's summary. */
export const loadUsage = Effect.flatMap(Usage, usage => Effect.map(usage.accounts, usageSummary))
