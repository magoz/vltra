import { describe, expect, it } from 'vitest'
import { usageSummary } from '@/lib/data/fleet/usage'
import type { QuotaAccount } from '@/lib/services/usage/service'

const account = (
  provider: string,
  windows: QuotaAccount['windows'],
  overrides: Partial<QuotaAccount> = {}
): QuotaAccount => ({
  provider,
  providerName: provider,
  account: `${provider}@x.com`,
  fresh: true,
  windows,
  ...overrides
})

const window = (
  id: string,
  remainingPercent: number,
  resetsAt?: number,
  durationMinutes?: number
) => ({
  id,
  label: id,
  remainingPercent,
  durationMinutes,
  resetsAt
})

const week = 7 * 24 * 60

describe('usage summary', () => {
  it('one pool per provider, Claude, Codex and Go first, the rest as reported', () => {
    const summary = usageSummary([
      account('other', [window('weekly', 50)], { providerName: 'Other AI' }),
      account('opencode-go', [window('weekly', 50)]),
      account('codex', [window('weekly', 50)]),
      account('anthropic', [window('weekly', 50)])
    ])

    expect(summary.pools.map(pool => pool.name)).toEqual(['Claude', 'Codex', 'Go', 'Other AI'])
  })

  it('shows the weekly window, even when a shorter one has less left, never a model-scoped one', () => {
    const [claude] = usageSummary([
      account('anthropic', [
        window('five-hour', 30, 1000, 300),
        window('weekly', 45, 2000, week),
        window('weekly-scoped-fable', 3, undefined, week)
      ])
    ]).pools

    expect(claude?.reading).toEqual({ left: 45, capacity: 100 })
    // Every window stays in the details.
    expect(claude?.windows).toEqual([
      { account: 'anthropic@x.com', label: 'five-hour', left: 30, resetsAt: 1000 },
      { account: 'anthropic@x.com', label: 'weekly', left: 45, resetsAt: 2000 },
      { account: 'anthropic@x.com', label: 'weekly-scoped-fable', left: 3, resetsAt: undefined }
    ])
  })

  it('falls back to the first account-wide window when there is no weekly one', () => {
    const [go] = usageSummary([
      account('opencode-go', [window('rolling', 70, 1000, 300), window('monthly', 20, 2000)])
    ]).pools

    expect(go?.reading).toEqual({ left: 70, capacity: 100 })
  })

  it("sums a pool's accounts, 100% each; ones without a reading do not count", () => {
    const [codex] = usageSummary([
      account('codex', [window('weekly', 6, undefined, week)], { account: 'a@x.com' }),
      account(
        'codex',
        [window('five-hour', 40, undefined, 300), window('weekly', 100, undefined, week)],
        {
          account: 'b@x.com'
        }
      ),
      account('codex', [], { account: 'c@x.com', fresh: false })
    ]).pools

    expect(codex).toMatchObject({ reading: { left: 106, capacity: 200 }, stale: true })
  })

  it("carries the first of the accounts' weekly resets, never a 5-hour or model-scoped one", () => {
    const [claude] = usageSummary([
      account('anthropic', [window('five-hour', 90, 100, 300), window('weekly', 6, 3000, week)], {
        account: 'a@x.com'
      }),
      account(
        'anthropic',
        [window('weekly', 100, 5000, week), window('weekly-scoped-opus', 50, 2000, week)],
        { account: 'b@x.com' }
      )
    ]).pools

    expect(claude?.weeklyResetAt).toBe(3000)
  })

  it('has no figure when no account reports', () => {
    const [go] = usageSummary([account('opencode-go', [], { fresh: false })]).pools

    expect(go).toEqual({
      provider: 'opencode-go',
      name: 'Go',
      reading: undefined,
      stale: true,
      windows: []
    })
  })
})
