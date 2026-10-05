import { describe, expect, it } from '@effect/vitest'
import { Option } from 'effect'
import { decodeModelRef } from '@/lib/services/opencode/live-layer'

describe('decodeModelRef', () => {
  it('reads provider/model with an optional #variant, the `opencode --model` form', () => {
    expect(decodeModelRef('opencode-go/qwen3.8-flash#none')).toEqual(
      Option.some({ providerID: 'opencode-go', id: 'qwen3.8-flash', variant: 'none' })
    )
    expect(decodeModelRef('subs-codex/gpt-6-astra')).toEqual(
      Option.some({ providerID: 'subs-codex', id: 'gpt-6-astra' })
    )
    // The model id may itself contain `/`.
    expect(decodeModelRef('openrouter/qwen/qwen3#low')).toEqual(
      Option.some({ providerID: 'openrouter', id: 'qwen/qwen3', variant: 'low' })
    )
  })

  it('rejects refs without a provider, a model or a variant after #', () => {
    for (const value of ['qwen3', '/qwen3', 'opencode-go/', 'opencode-go/qwen3#', '#none']) {
      expect(decodeModelRef(value), value).toEqual(Option.none())
    }
  })
})
