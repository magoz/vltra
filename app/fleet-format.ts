import type { ActiveState } from '@/lib/data/fleet/board'
import type { PendingPermission, SessionActivity } from '@/lib/data/fleet/types'

// Display formatting for the dashboard. Pure; times are epoch milliseconds.

const minute = 60 * 1000

const hour = 60 * minute

const day = 24 * hour

/** Compact age: `now`, `4m`, `3h`, `2d`. */
export const relativeTime = (at: number, now: number): string => {
  const age = Math.max(0, now - at)

  if (age < minute) return 'now'

  if (age < hour) return `${Math.floor(age / minute)}m`

  if (age < day) return `${Math.floor(age / hour)}h`

  return `${Math.floor(age / day)}d`
}

/** `openai/gpt-6-astra` → `gpt-6-astra`. */
export const modelName = (model: string | undefined): string | undefined =>
  model === undefined ? undefined : (model.split('/').at(-1) ?? model)

/** Cost so far; nothing for free sessions. */
export const formatCost = (cost: number): string | undefined => {
  if (cost <= 0) return undefined

  if (cost < 0.01) return '<$0.01'

  return `$${cost.toFixed(2)}`
}

export const activityText = (activity: SessionActivity): string => {
  switch (activity.kind) {
    case 'thinking':
      return 'thinking…'
    case 'writing':
      return 'writing…'
    case 'tool': {
      const tool = activity.tool ?? 'tool'

      return activity.detail === undefined ? `running ${tool}` : `${tool}: ${activity.detail}`
    }
  }
}

export const sectionTitle = (state: ActiveState): string => {
  switch (state) {
    case 'needs-you':
      return 'Needs you'
    case 'failed':
      return 'Failed'
    case 'working':
      return 'Working'
    case 'done':
      return 'Done · unseen'
  }
}

/** What the permission is for: the resources, or the action alone when there are none. */
export const permissionTarget = (permission: PendingPermission): string =>
  permission.resources.length === 0 ? permission.action : permission.resources.join(', ')

export const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`
