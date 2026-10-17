import type { TrackedSession } from '@/lib/data/vltra/model'
import type { SessionRecord } from '@/lib/data/vltra/types'

// Small builders for Vltra domain values in tests.

export const baseTime = 1_790_000_000_000

export const sessionRecord = (
  id: string,
  overrides: Partial<SessionRecord> = {}
): SessionRecord => ({
  id,
  projectID: 'prj_vltra',
  directory: '/home/me/dev/repos/vltra',
  title: `Session ${id}`,
  cost: 0,
  tokens: 0,
  created: baseTime,
  ...overrides
})

export const trackedSession = (
  info: SessionRecord,
  overrides: Partial<Omit<TrackedSession, 'info'>> = {}
): TrackedSession => ({
  info,
  running: false,
  retry: undefined,
  activity: undefined,
  activityCall: undefined,
  startedAt: undefined,
  activityAt: undefined,
  interrupt: undefined,
  ...overrides
})

export const webUrl = new URL('https://vltra.localhost')
