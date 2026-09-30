import type { TrackedSession } from '@/lib/data/fleet/model'
import type { SessionRecord } from '@/lib/data/fleet/types'

// Small builders for Fleet domain values in tests.

export const baseTime = 1_790_000_000_000

export const sessionRecord = (
  id: string,
  overrides: Partial<SessionRecord> = {}
): SessionRecord => ({
  id,
  projectID: 'prj_fleet',
  directory: '/home/magoz/dev/repos/fleet',
  title: `Session ${id}`,
  cost: 0,
  created: baseTime,
  updated: baseTime,
  ...overrides
})

export const trackedSession = (
  info: SessionRecord,
  overrides: Partial<Omit<TrackedSession, 'info'>> = {}
): TrackedSession => ({ info, running: false, stepFailed: false, retry: undefined, ...overrides })

export const webUrl = new URL('https://box.tail129a86.ts.net:9446')
