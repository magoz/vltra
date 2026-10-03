import { describe, expect, it } from 'vitest'
import {
  activityText,
  endText,
  formatCost,
  modelName,
  pendingText,
  relativeTime
} from '@/app/fleet-format'

describe('formatting', () => {
  it('ages compactly', () => {
    expect(relativeTime(0, 30_000)).toBe('now')
    expect(relativeTime(0, 12 * 60_000)).toBe('12m')
    expect(relativeTime(0, 5 * 3_600_000)).toBe('5h')
    expect(relativeTime(0, 3 * 86_400_000)).toBe('3d')
    expect(relativeTime(10, 0)).toBe('now')
  })

  it('shortens models and hides free sessions’ cost', () => {
    expect(modelName('openai/gpt-6-astra')).toBe('gpt-6-astra')
    expect(modelName(undefined)).toBeUndefined()
    expect(formatCost(0)).toBeUndefined()
    expect(formatCost(0.004)).toBe('<$0.01')
    expect(formatCost(0.842)).toBe('$0.84')
  })

  it('describes live activity', () => {
    expect(activityText({ kind: 'thinking' })).toBe('thinking…')
    expect(activityText({ kind: 'writing' })).toBe('writing…')
    expect(activityText({ kind: 'tool', tool: 'read' })).toBe('running read')
    expect(activityText({ kind: 'tool', tool: 'bash', detail: 'pnpm build' })).toBe(
      'bash: pnpm build'
    )
  })

  it('says what a blocked row waits on and how a run ended', () => {
    expect(pendingText({ pending: { permissions: 1, forms: 0 } })).toBe('1 permission')
    expect(pendingText({ pending: { permissions: 2, forms: 1 } })).toBe(
      '2 permissions · 1 question'
    )

    expect(endText({ outcome: 'failed' })).toBe('run failed')
    expect(endText({ outcome: 'interrupted', interrupt: 'inactivity' })).toBe('stopped by OpenCode')
    expect(endText({ outcome: 'succeeded' })).toBe('finished')
  })
})
