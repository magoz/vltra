import { liveFrom } from '@/app/testing/dashboard-fixtures'
import type { LiveVltra } from '@/lib/data/vltra/board'
import { baseTime, sessionRecord } from '@/lib/data/vltra/testing/fixtures'
import type {
  Launch,
  LauncherList,
  PendingPermission,
  SessionRecord,
  SessionTally
} from '@/lib/data/vltra/types'

// One vltra for the page tests: every state, a worktree, a second project, the Other group, and
// handled sessions inside and outside the Agents board's 24h window.

const minute = 60_000

export const hour = 60 * minute

export const now = baseTime + 48 * hour

const vltra = '/home/me/dev/repos/vltra'

const worktree = '/home/me/.local/share/opencode/worktree/vltra/feat-x'

export const vltraDone = '/home/me/dev/repos/vltra-feat-done'

export const vltraPi = '/home/me/dev/repos/vltra-pi-thing'

export const anvil = '/home/me/dev/repos/anvil'

const box = '/home/me/dev/repos/box'

const finished = (at: number, outcome: 'succeeded' | 'failed' = 'succeeded') => ({
  idle: at,
  outcome
})

const handled = (at: number) => ({ ...finished(at), handled: at })

const ask = (id: string, sessionID: string): PendingPermission => ({
  id,
  sessionID,
  action: 'bash',
  resources: [`pnpm test ${id}`]
})

const sessions: ReadonlyArray<SessionRecord> = [
  sessionRecord('ses_wait_new', { title: 'Wait new', created: now - hour }),
  sessionRecord('ses_wait_old', { title: 'Wait old', created: now - 3 * hour }),
  sessionRecord('ses_done_new', { title: 'Done new', ...finished(now - 30 * minute) }),
  sessionRecord('ses_done_old', { title: 'Done old', ...finished(now - 5 * hour, 'failed') }),
  sessionRecord('ses_run', { title: 'Quiet run', created: now - 2 * hour }),
  sessionRecord('ses_retry', { title: 'Retry run', created: now - 3 * hour, directory: worktree }),
  sessionRecord('ses_busy', { title: 'Busy run', created: now - 30 * minute }),
  sessionRecord('ses_handled', { title: 'Handled one', ...handled(now - 2 * hour) }),
  sessionRecord('ses_ancient', { title: 'Ancient one', ...handled(now - 30 * 24 * hour) }),
  sessionRecord('ses_box', {
    title: 'Box route',
    projectID: 'prj_box',
    directory: box,
    ...handled(now - 5 * hour)
  }),
  sessionRecord('ses_tmp', {
    title: 'Scratch',
    projectID: 'global',
    directory: '/tmp/scratch',
    ...handled(now - 10 * minute)
  })
]

export const vltraLive = (): LiveVltra =>
  liveFrom(
    {
      sessions,
      running: ['ses_run', 'ses_retry', 'ses_busy'],
      permissions: [ask('per_new', 'ses_wait_new'), ask('per_old', 'ses_wait_old')],
      projects: [
        { id: 'prj_vltra', name: 'vltra', directory: vltra },
        { id: 'prj_box', name: 'box', directory: box },
        { id: 'global', directory: '/' }
      ],
      worktrees: [{ projectID: 'prj_vltra', directories: [worktree] }]
    },
    now,
    new Map([
      ['ses_run', { activityAt: now - 15 * minute }],
      ['ses_retry', { retry: { attempt: 2, at: now, message: 'rate limited' } }],
      ['ses_busy', { activityAt: now - minute, activity: { kind: 'thinking' } }]
    ])
  )

/** The session ids of the `li[data-session]` rows under `area`, in order. */
export const rowIDs = (area: HTMLElement) =>
  Array.from(area.querySelectorAll('li[data-session]'), row => row.getAttribute('data-session'))

const tally = (counts: Partial<SessionTally> = {}): SessionTally => ({
  blocked: 0,
  working: 0,
  finished: 0,
  handled: 0,
  ...counts
})

/**
 * `GET /api/vltra/launcher` for the scenario: vltra with its busy Vltra worktree (`feat/x`, PR
 * open), an idle merged one (`feat/done`) and a Pi worktree (PR closed); box; anvil, which
 * OpenCode never opened.
 */
export const launcherList = (): LauncherList => ({
  generatedAt: now,
  entries: [
    {
      kind: 'repo',
      name: 'vltra',
      directory: vltra,
      projectID: 'prj_vltra',
      sessions: tally({ blocked: 2, working: 2, finished: 2, handled: 2 }),
      latestSession: 'ses_busy',
      activeAt: now - minute,
      lastActivity: now - minute,
      worktrees: [
        {
          directory: worktree,
          branch: 'feat/x',
          owner: 'dotfiles',
          pr: {
            state: 'open',
            number: 7,
            url: 'https://github.com/o/vltra/pull/7',
            issues: [{ number: 4, url: 'https://github.com/o/vltra/issues/4' }]
          },
          sessions: tally({ working: 1 }),
          latestSession: 'ses_retry',
          activeAt: now - 3 * hour
        },
        {
          directory: vltraDone,
          branch: 'feat/done',
          owner: 'dotfiles',
          pr: { state: 'merged', number: 5, url: 'https://github.com/o/vltra/pull/5' },
          sessions: tally()
        },
        {
          directory: vltraPi,
          branch: 'pi/thing',
          owner: 'other',
          pr: { state: 'closed', number: 3, url: 'https://github.com/o/vltra/pull/3' },
          sessions: tally()
        }
      ]
    },
    {
      kind: 'repo',
      name: 'box',
      directory: box,
      projectID: 'prj_box',
      sessions: tally({ handled: 1 }),
      latestSession: 'ses_box',
      activeAt: now - 5 * hour,
      lastActivity: now - 5 * hour,
      worktrees: []
    },
    { kind: 'repo', name: 'anvil', directory: anvil, sessions: tally(), worktrees: [] }
  ]
})

/** A launch as the event stream carries it. */
export const launch = (overrides: Partial<Launch> = {}): Launch => ({
  id: 'launch-1',
  repo: vltra,
  repoName: 'vltra',
  branch: 'feat/palette',
  task: 'Add the launcher palette',
  status: 'provisioning',
  startedAt: now - 42_000,
  updatedAt: now - 42_000,
  ...overrides
})

/** Answers `fetch` like Vltra: the launcher list, 404 for everything else. */
export const launcherFetch =
  (list: LauncherList = launcherList()) =>
  (input: RequestInfo | URL) =>
    Promise.resolve(
      String(input) === '/api/vltra/launcher'
        ? Response.json(list)
        : new Response('{}', { status: 404 })
    )
