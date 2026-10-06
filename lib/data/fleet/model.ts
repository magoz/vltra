import { FleetEvent } from '@/lib/data/fleet/events'
import type {
  InterruptReason,
  PendingForm,
  PendingPermission,
  ProjectRecord,
  RetryInfo,
  SessionActivity,
  SessionRecord
} from '@/lib/data/fleet/types'

/** A session plus the live execution facts that only the event stream carries. */
export type TrackedSession = {
  readonly info: SessionRecord
  readonly running: boolean
  /** Latest scheduled retry of the current run; cleared by the next step or the run's end. */
  readonly retry: RetryInfo | undefined
  /** Live activity while running; only known from events seen since the last (re)connect. */
  readonly activity: SessionActivity | undefined
  /** The tool call `activity` describes, to attach its input summary once it is complete. */
  readonly activityCall: string | undefined
  /** Start of the current run, when seen on the stream. */
  readonly startedAt: number | undefined
  /** Last start/step/tool/text event of the current run; the connect time after a snapshot. */
  readonly activityAt: number | undefined
  /**
   * Why the latest run (ending at `info.idle`) was interrupted, when known: from the live event,
   * or recovered from the session log after Fleet missed it.
   */
  readonly interrupt: InterruptReason | undefined
}

/** Everything Fleet knows about OpenCode. Rebuilt from a snapshot on every (re)connect. */
export type FleetModel = {
  readonly sessions: ReadonlyMap<string, TrackedSession>
  readonly permissions: ReadonlyMap<string, PendingPermission>
  readonly forms: ReadonlyMap<string, PendingForm>
  readonly projects: ReadonlyMap<string, ProjectRecord>
  /** Saved worktree directories per project. */
  readonly worktrees: ReadonlyMap<string, ReadonlyArray<string>>
  /**
   * Whether each session directory is gone from disk (checked by Fleet, not reported by
   * OpenCode); absent until checked. A session whose folder is gone counts as handled.
   */
  readonly directoryGone: ReadonlyMap<string, boolean>
}

/** What OpenCode reports at snapshot time (after the event subscription is live). */
export type OpenCodeSnapshot = {
  readonly sessions: ReadonlyArray<SessionRecord>
  /** Ids of sessions with an active execution (`GET /api/session/active`). */
  readonly running: ReadonlyArray<string>
  readonly permissions: ReadonlyArray<PendingPermission>
  readonly forms: ReadonlyArray<PendingForm>
  readonly projects: ReadonlyArray<ProjectRecord>
  readonly worktrees: ReadonlyArray<{
    readonly projectID: string
    readonly directories: ReadonlyArray<string>
  }>
}

export const emptyModel: FleetModel = {
  sessions: new Map(),
  permissions: new Map(),
  forms: new Map(),
  projects: new Map(),
  worktrees: new Map(),
  directoryGone: new Map()
}

const track = (info: SessionRecord): TrackedSession => ({
  info,
  running: false,
  retry: undefined,
  activity: undefined,
  activityCall: undefined,
  startedAt: undefined,
  activityAt: undefined,
  interrupt: undefined
})

/**
 * The model for a fresh snapshot loaded at `now`, with the checked session directories. Running
 * sessions count as active at `now`: their start and last activity predate the connection and are
 * unknown.
 */
export const fromSnapshot = (
  snapshot: OpenCodeSnapshot,
  now: number,
  directoryGone: ReadonlyMap<string, boolean> = new Map()
): FleetModel => {
  const running = new Set(snapshot.running)

  const tracked = (info: SessionRecord): TrackedSession =>
    running.has(info.id) ? { ...track(info), running: true, activityAt: now } : track(info)

  return {
    sessions: new Map(snapshot.sessions.map(info => [info.id, tracked(info)] as const)),
    permissions: new Map(snapshot.permissions.map(item => [item.id, item] as const)),
    forms: new Map(snapshot.forms.map(item => [item.id, item] as const)),
    projects: new Map(snapshot.projects.map(item => [item.id, item] as const)),
    worktrees: new Map(snapshot.worktrees.map(item => [item.projectID, item.directories] as const)),
    directoryGone
  }
}

/** The distinct directories of the snapshot's sessions (what to check before `fromSnapshot`). */
export const snapshotDirectories = (snapshot: OpenCodeSnapshot): ReadonlySet<string> =>
  new Set(snapshot.sessions.map(info => info.directory))

/** The distinct directories of every session in the model. */
export const sessionDirectories = (model: FleetModel): ReadonlySet<string> =>
  new Set(Array.from(model.sessions.values(), session => session.info.directory))

/** Session directories never checked yet (new or moved sessions). */
export const uncheckedDirectories = (model: FleetModel): ReadonlyArray<string> =>
  Array.from(sessionDirectories(model)).filter(directory => !model.directoryGone.has(directory))

/** Whether the session's folder is known to be gone from disk. */
export const isFolderGone = (model: FleetModel, session: TrackedSession): boolean =>
  model.directoryGone.get(session.info.directory) === true

const withEntry = <V>(map: ReadonlyMap<string, V>, key: string, value: V) =>
  new Map(map).set(key, value)

const withoutEntry = <V>(map: ReadonlyMap<string, V>, key: string): ReadonlyMap<string, V> => {
  if (!map.has(key)) return map

  const next = new Map(map)

  next.delete(key)

  return next
}

const withoutSession = <V extends { readonly sessionID: string }>(
  map: ReadonlyMap<string, V>,
  sessionID: string
): ReadonlyMap<string, V> =>
  new Map(Array.from(map).flatMap(entry => (entry[1].sessionID === sessionID ? [] : [entry])))

const updateSession = (
  model: FleetModel,
  sessionID: string,
  update: (session: TrackedSession) => TrackedSession
): FleetModel => {
  const session = model.sessions.get(sessionID)

  if (session === undefined) return model

  return { ...model, sessions: withEntry(model.sessions, sessionID, update(session)) }
}

const patchInfo = (session: TrackedSession, info: Partial<SessionRecord>): TrackedSession => ({
  ...session,
  info: { ...session.info, ...info }
})

/** Not running: no retry and no live activity. */
const idleSession = (session: TrackedSession): TrackedSession => ({
  ...session,
  running: false,
  retry: undefined,
  activity: undefined,
  activityCall: undefined,
  startedAt: undefined,
  activityAt: undefined
})

/** Running; a session that was not running starts its activity clock at `at`. */
const busySession = (session: TrackedSession, at: number): TrackedSession =>
  session.running ? session : { ...session, running: true, activityAt: at }

const touch = (session: TrackedSession, at: number): TrackedSession => ({
  ...session,
  activityAt: Math.max(session.activityAt ?? at, at)
})

/** A new step (or text, or tool call) means a scheduled retry went through. */
const setActivity = (
  session: TrackedSession,
  activity: SessionActivity,
  callID: string | undefined,
  at: number
): TrackedSession => ({ ...touch(session, at), activity, activityCall: callID, retry: undefined })

/** Attach a finished tool input summary to the matching current tool call, if it still is. */
const describeCall = (
  session: TrackedSession,
  callID: string,
  detail: string | undefined
): TrackedSession =>
  session.activityCall === callID && session.activity !== undefined && detail !== undefined
    ? { ...session, activity: { ...session.activity, detail } }
    : session

const endExecution = (
  session: TrackedSession,
  event: Extract<FleetEvent, { readonly _tag: 'ExecutionEnded' }>
): TrackedSession => {
  const stopped = idleSession(session)

  // OpenCode does not stamp `time.idle` for shutdown interruptions: the run resumes later.
  if (event.reason === 'shutdown') return stopped

  const interrupt = event.outcome === 'interrupted' ? event.reason : undefined
  const idle = session.info.idle

  // OpenCode records `time.idle = max(created, previousIdle + 1)`. A terminal event at or before
  // the known idle watermark is already reflected (for example replayed after a snapshot); it
  // still names the interrupt reason when it matches the stored outcome.
  if (idle !== undefined && event.at <= idle) {
    return session.info.outcome === event.outcome ? { ...stopped, interrupt } : stopped
  }

  return patchInfo({ ...stopped, interrupt }, { idle: event.at, outcome: event.outcome })
}

const markViewed = (session: TrackedSession, idle: number): TrackedSession =>
  patchInfo(session, { viewed: Math.max(session.info.viewed ?? idle, idle) })

/** A re-read session keeps its live facts, and its interrupt reason while it is the same run. */
const refresh = (existing: TrackedSession, info: SessionRecord): TrackedSession => ({
  ...existing,
  info,
  interrupt:
    info.outcome === 'interrupted' && info.idle === existing.info.idle
      ? existing.interrupt
      : undefined
})

const recoverInterrupt = (
  session: TrackedSession,
  idle: number,
  reason: InterruptReason
): TrackedSession =>
  session.info.idle === idle && session.info.outcome === 'interrupted'
    ? { ...session, interrupt: reason }
    : session

/**
 * The Fleet state machine: applies one OpenCode event to the model. Pure and idempotent for
 * events already reflected in a snapshot, so buffered events can be replayed after a resync.
 */
export const applyEvent = (model: FleetModel, event: FleetEvent): FleetModel =>
  FleetEvent.$match(event, {
    SessionUpserted: ({ session }) => {
      const existing = model.sessions.get(session.id)

      return {
        ...model,
        sessions: withEntry(
          model.sessions,
          session.id,
          existing === undefined ? track(session) : refresh(existing, session)
        )
      }
    },
    SessionRemoved: ({ sessionID }) => ({
      ...model,
      sessions: withoutEntry(model.sessions, sessionID),
      permissions: withoutSession(model.permissions, sessionID),
      forms: withoutSession(model.forms, sessionID)
    }),
    SessionRenamed: ({ sessionID, title }) =>
      updateSession(model, sessionID, session => patchInfo(session, { title })),
    AgentSelected: ({ sessionID, agent }) =>
      updateSession(model, sessionID, session => patchInfo(session, { agent })),
    ModelSelected: ({ sessionID, model: selected }) =>
      updateSession(model, sessionID, session => patchInfo(session, { model: selected })),
    UsageUpdated: ({ sessionID, cost, tokens }) =>
      updateSession(model, sessionID, session => patchInfo(session, { cost, tokens })),
    ExecutionStarted: ({ sessionID, at }) =>
      updateSession(model, sessionID, session => ({
        ...idleSession(session),
        running: true,
        startedAt: at,
        activityAt: at
      })),
    ExecutionEnded: ended =>
      updateSession(model, ended.sessionID, session => endExecution(session, ended)),
    RetryScheduled: ({ sessionID, retry, at }) =>
      updateSession(model, sessionID, session => ({ ...busySession(session, at), retry })),
    StatusChanged: ({ sessionID, status, at }) =>
      updateSession(model, sessionID, session =>
        status === 'idle' ? idleSession(session) : busySession(session, at)
      ),
    ActivityChanged: ({ sessionID, activity, callID, at }) =>
      updateSession(model, sessionID, session => setActivity(session, activity, callID, at)),
    ToolCalled: ({ sessionID, callID, detail, at }) =>
      updateSession(model, sessionID, session => describeCall(touch(session, at), callID, detail)),
    Viewed: ({ sessionID, idle }) =>
      updateSession(model, sessionID, session => markViewed(session, idle)),
    HandledChanged: ({ sessionID, handled }) =>
      updateSession(model, sessionID, session => patchInfo(session, { handled })),
    InterruptRecovered: ({ sessionID, idle, reason }) =>
      updateSession(model, sessionID, session => recoverInterrupt(session, idle, reason)),
    PermissionAsked: ({ permission }) => ({
      ...model,
      permissions: withEntry(model.permissions, permission.id, permission)
    }),
    PermissionReplied: ({ requestID }) => ({
      ...model,
      permissions: withoutEntry(model.permissions, requestID)
    }),
    FormCreated: ({ form }) => ({ ...model, forms: withEntry(model.forms, form.id, form) }),
    FormSettled: ({ formID }) => ({ ...model, forms: withoutEntry(model.forms, formID) }),
    ProjectUpserted: ({ project }) => ({
      ...model,
      projects: withEntry(model.projects, project.id, project)
    }),
    WorktreesLoaded: ({ projectID, directories }) => ({
      ...model,
      worktrees: withEntry(model.worktrees, projectID, directories)
    }),
    DirectoriesChecked: ({ directories }) => ({
      ...model,
      directoryGone: new Map([...model.directoryGone, ...directories])
    })
  })

export const applyEvents = (model: FleetModel, events: ReadonlyArray<FleetEvent>): FleetModel =>
  events.reduce(applyEvent, model)
