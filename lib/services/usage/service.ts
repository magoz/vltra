import { Context, Schema } from 'effect'
import type { Effect } from 'effect'

/** One quota window of an account, as the usage dashboard reports it. */
export type QuotaWindow = {
  /** `five-hour`, `weekly`, `weekly-scoped-<model>` (binds one model only), ... */
  readonly id: string
  readonly label: string
  readonly remainingPercent: number
  /** The window's length (`10080` for a week); absent when the dashboard does not say. */
  readonly durationMinutes: number | undefined
  /** Epoch milliseconds; absent when the provider does not say. */
  readonly resetsAt: number | undefined
}

/** One subscription account (a pool may have several, e.g. Codex). */
export type QuotaAccount = {
  /** `anthropic`, `codex`, `opencode-go`, ... */
  readonly provider: string
  readonly providerName: string
  readonly account: string
  /** Whether the reading is current; a failed refresh keeps the last one (stale). */
  readonly fresh: boolean
  /**
   * The model proxy currently routes its pool here (the dashboard's `routing`, from the proxy's
   * sticky-fill-first pins); false when it does not or nobody knows.
   */
  readonly active: boolean
  /** The proxy can no longer use its credential (refresh token rejected) until it logs in again. */
  readonly loggedOut: boolean
  readonly windows: ReadonlyArray<QuotaWindow>
}

/** The usage dashboard is down, unreachable, or answered something Vltra cannot read. */
export class UsageUnavailableError extends Schema.TaggedError<UsageUnavailableError>()(
  'UsageUnavailableError',
  { message: Schema.String }
) {}

export type UsageOperations = {
  /** Every account's quota windows (`GET /api/usage`; the dashboard caches its own readings). */
  readonly accounts: Effect.Effect<ReadonlyArray<QuotaAccount>, UsageUnavailableError>
}

/**
 * The subscription quotas behind the model proxy, read from the `usage` dashboard (magoz/usage) on
 * this machine. Read-only.
 */
export class Usage extends Context.Service<Usage, UsageOperations>()('@vltra/Usage') {}
