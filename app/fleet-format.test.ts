import { describe, expect, it } from 'vitest'
import { activityText, formatCost, modelName, relativeTime } from '@/app/fleet-format'

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
})
