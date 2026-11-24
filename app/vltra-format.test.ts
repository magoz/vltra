import { describe, expect, it } from 'vitest'
import { rowFrom } from '@/app/testing/dashboard-fixtures'
import {
  activityText,
  elapsedText,
  endText,
  pendingText,
  relativeTime,
  scriptText,
  servingText
} from '@/app/vltra-format'
import { baseTime, runningShell, sessionRecord } from '@/lib/data/vltra/testing/fixtures'

describe('formatting', () => {
  it('ages compactly', () => {
    expect(relativeTime(0, 30_000)).toBe('now')
    expect(relativeTime(0, 12 * 60_000)).toBe('12m')
    expect(relativeTime(0, 5 * 3_600_000)).toBe('5h')
    expect(relativeTime(0, 3 * 86_400_000)).toBe('3d')
    expect(relativeTime(10, 0)).toBe('now')
  })

  it('shows elapsed time as a clock', () => {
    expect(elapsedText(7_400)).toBe('0:07')
    expect(elapsedText(185_000)).toBe('3:05')
    expect(elapsedText(3_730_000)).toBe('1:02:10')
    expect(elapsedText(-5)).toBe('0:00')
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

  it('says which background script a working row waits on, and for how long', () => {
    const ended = sessionRecord('ses_1', { idle: baseTime, outcome: 'succeeded' })
    const now = baseTime + 4 * 60_000

    const script = (id: string, command: string, started: number) =>
      runningShell(id, 'ses_1', { command, started })

    const one = rowFrom(
      { sessions: [ended], shells: [script('sh_1', 'pnpm test', baseTime)] },
      'ses_1'
    )

    const two = rowFrom(
      {
        sessions: [ended],
        shells: [
          script('sh_2', 'pnpm build', baseTime + 60_000),
          script('sh_1', 'pnpm test', baseTime)
        ]
      },
      'ses_1'
    )

    expect(scriptText(one, now)).toBe('waiting on pnpm test · 4m')
    expect(scriptText(two, now)).toBe('waiting on 2 scripts · 4m')
    expect(scriptText(rowFrom({ sessions: [ended] }, 'ses_1'), now)).toBeUndefined()
  })

  it('says which ports the services a session left running listen on', () => {
    const row = rowFrom(
      {
        sessions: [sessionRecord('ses_1', { idle: baseTime, handled: baseTime })],
        shells: [
          runningShell('sh_1', 'ses_1', { command: 'pnpm dev' }),
          runningShell('sh_2', 'ses_1', { command: 'pnpm storybook' }),
          runningShell('sh_3', 'ses_1', { command: 'pnpm test' })
        ]
      },
      'ses_1'
    )

    const ports = new Map([
      ['sh_1', [3000]],
      ['sh_2', [6006, 3000]]
    ])

    const checked = {
      ...row,
      shells: row.shells.map(shell => ({ ...shell, ports: ports.get(shell.id) ?? [] }))
    }

    expect(servingText(checked)).toEqual({
      text: 'serving :3000, :6006',
      commands: 'pnpm dev\npnpm storybook'
    })
    expect(servingText(row)).toBeUndefined()
  })
})
