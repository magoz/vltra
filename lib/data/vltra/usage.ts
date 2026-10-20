import { Effect } from 'effect'
import type { UsagePool, UsageReading, UsageSummary } from '@/lib/data/vltra/types'
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

/**
 * The account's headline window: its longest account-wide one (weekly for Claude and Codex,
 * monthly for Go), else its first, as the `usage` dashboard's `summaryWindow` picks it, so both
 * show the same figure.
 */
const headline = (account: QuotaAccount): QuotaWindow | undefined => {
  const binding = account.windows.filter(window => !isModelScoped(window))

  return (
    binding.reduce<QuotaWindow | undefined>(
      (best, window) =>
        window.durationMinutes !== undefined &&
        (best?.durationMinutes === undefined || window.durationMinutes > best.durationMinutes)
          ? window
          : best,
      undefined
    ) ?? binding[0]
  )
}

/** The first reset among the accounts' headline windows. */
const firstReset = (accounts: ReadonlyArray<QuotaAccount>) => {
  const resets = accounts.flatMap(account => {
    const resetsAt = headline(account)?.resetsAt

    return resetsAt === undefined ? [] : [resetsAt]
  })

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

/** The accounts the proxy routes to first, then the rest in the dashboard's order, logged-out last. */
const activeFirst = (accounts: ReadonlyArray<QuotaAccount>) => {
  const serving = accounts.filter(account => !account.loggedOut)

  return [
    ...serving.filter(account => account.active),
    ...serving.filter(account => !account.active),
    ...accounts.filter(account => account.loggedOut)
  ]
}

const toPool = (pool: ReadonlyArray<QuotaAccount>, provider: string): UsagePool => {
  const accounts = activeFirst(pool)
  const serving = accounts.filter(account => !account.loggedOut)

  const name =
    knownProviders.find(known => known.provider === provider)?.name ??
    accounts[0]?.providerName ??
    provider

  const reading = pooled(
    serving.flatMap(account => {
      const value = headline(account)?.remainingPercent

      return value === undefined ? [] : [value]
    })
  )

  return {
    provider,
    name,
    reading,
    resetAt: firstReset(serving),
    stale: serving.some(account => !account.fresh),
    activeAccounts: serving.filter(account => account.active).map(account => account.account),
    loggedOutAccounts: accounts
      .filter(account => account.loggedOut)
      .map(account => account.account),
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
 * One pool per provider, Claude, Codex and Go first: how much is left of the headline window
 * (the longest: weekly, Go's monthly; summed over the pool's accounts, out of 100% each), its
 * first reset, the accounts the proxy routes to, and every window for the details, those
 * accounts' first. Logged-out accounts count in none of the figures and are only listed.
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

/** The usage dashboard's accounts as Vltra's summary. */
export const loadUsage = Effect.flatMap(Usage, usage => Effect.map(usage.accounts, usageSummary))
