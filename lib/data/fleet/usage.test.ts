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

const window = (id: string, remainingPercent: number, resetsAt?: number) => ({
  id,
  label: id,
  remainingPercent,
  resetsAt
})

describe('usage summary', () => {
  it('one pool per provider, Claude, Codex, Z.AI and Go first, the rest as reported', () => {
    const summary = usageSummary([
      account('other', [window('weekly', 50)], { providerName: 'Other AI' }),
      account('opencode-go', [window('weekly', 50)]),
      account('codex', [window('weekly', 50)]),
      account('anthropic', [window('weekly', 50)]),
      account('zai', [window('weekly', 50)])
    ])

    expect(summary.pools.map(pool => pool.name)).toEqual([
      'Claude',
      'Codex',
      'Z.AI',
      'Go',
      'Other AI'
    ])
  })

  it('shows the window that runs out first, never a model-scoped one', () => {
    const [claude] = usageSummary([
      account('anthropic', [
        window('five-hour', 89, 1000),
        window('weekly', 45, 2000),
        window('weekly-scoped-fable', 3)
      ])
    ]).pools

    expect(claude?.reading).toEqual({ left: 45, capacity: 100 })
    // Every window stays in the details.
    expect(claude?.windows).toEqual([
      { account: 'anthropic@x.com', label: 'five-hour', left: 89, resetsAt: 1000 },
      { account: 'anthropic@x.com', label: 'weekly', left: 45, resetsAt: 2000 },
      { account: 'anthropic@x.com', label: 'weekly-scoped-fable', left: 3, resetsAt: undefined }
    ])
  })

  it("sums a pool's accounts, 100% each; ones without a reading do not count", () => {
    const [codex] = usageSummary([
      account('codex', [window('weekly', 6)], { account: 'a@x.com' }),
      account('codex', [window('five-hour', 40), window('weekly', 100)], { account: 'b@x.com' }),
      account('codex', [], { account: 'c@x.com', fresh: false })
    ]).pools

    expect(codex).toMatchObject({ reading: { left: 46, capacity: 200 }, stale: true })
  })

  it('has no figure when no account reports', () => {
    const [zai] = usageSummary([account('zai', [], { fresh: false })]).pools

    expect(zai).toEqual({
      provider: 'zai',
      name: 'Z.AI',
      reading: undefined,
      stale: true,
      windows: []
    })
  })
})
