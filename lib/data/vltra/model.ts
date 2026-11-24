import { VltraEvent } from '@/lib/data/vltra/events'
import { isHandled } from '@/lib/data/vltra/state'
import type {
  InterruptReason,
  PendingForm,
  PendingPermission,
  ProjectRecord,
  RetryInfo,
  RunningShell,
  RunningWatch,
  SessionActivity,
  SessionRecord
} from '@/lib/data/vltra/types'

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
   * or recovered from the session log after Vltra missed it.
   */
  readonly interrupt: InterruptReason | undefined
}

/** Everything Vltra knows about OpenCode. Rebuilt from a snapshot on every (re)connect. */
export type VltraModel = {
  readonly sessions: ReadonlyMap<string, TrackedSession>
  readonly permissions: ReadonlyMap<string, PendingPermission>
  readonly forms: ReadonlyMap<string, PendingForm>
  /** Running shell commands by shell id (background scripts once their run has ended). */
  readonly shells: ReadonlyMap<string, RunningShell>
  /**
   * The ports each running shell's process tree listens on (checked by Vltra, not reported by
   * OpenCode); absent until checked. A shell that listens is a service, not a script to wait on.
   */
  readonly shellPorts: ReadonlyMap<string, ReadonlyArray<number>>
  /** The `until` watches that will wake each session, by session id (none: absent). */
  readonly watches: ReadonlyMap<string, ReadonlyArray<RunningWatch>>
  readonly projects: ReadonlyMap<string, ProjectRecord>
  /** Saved worktree directories per project. */
  readonly worktrees: ReadonlyMap<string, ReadonlyArray<string>>
  /**
   * Whether each session directory is gone from disk (checked by Vltra, not reported by
   * OpenCode); absent until checked. A session whose folder is gone counts as handled
   * unless reopened.
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
  /** Running shell commands of every loaded location that name their session. */
  readonly shells: ReadonlyArray<RunningShell>
  readonly projects: ReadonlyArray<ProjectRecord>
  readonly worktrees: ReadonlyArray<{
    readonly projectID: string
    readonly directories: ReadonlyArray<string>
  }>
}

export const emptyModel: VltraModel = {
  sessions: new Map(),
  permissions: new Map(),
  forms: new Map(),
  shells: new Map(),
  shellPorts: new Map(),
  watches: new Map(),
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

/** Watches by the session they wake (a location's `waits` may be read twice: ids dedupe). */
const groupWatches = (
  watches: ReadonlyArray<RunningWatch>
): ReadonlyMap<string, ReadonlyArray<RunningWatch>> => {
  const groups = new Map<string, Map<string, RunningWatch>>()

  for (const watch of watches) {
    const group = groups.get(watch.sessionID) ?? new Map<string, RunningWatch>()

    groups.set(watch.sessionID, group.set(watch.id, watch))
  }

  return new Map(
    Array.from(groups, ([sessionID, group]) => [sessionID, Array.from(group.values())])
  )
}

/**
 * The model for a fresh snapshot loaded at `now`, with the checked session directories. Running
 * sessions count as active at `now`: their start and last activity predate the connection and are
 * unknown.
 */
export const fromSnapshot = (
  snapshot: OpenCodeSnapshot,
  now: number,
  directoryGone: ReadonlyMap<string, boolean> = new Map()
): VltraModel => {
  const running = new Set(snapshot.running)

  const tracked = (info: SessionRecord): TrackedSession =>
    running.has(info.id) ? { ...track(info), running: true, activityAt: now } : track(info)

  return {
    sessions: new Map(snapshot.sessions.map(info => [info.id, tracked(info)] as const)),
    permissions: new Map(snapshot.permissions.map(item => [item.id, item] as const)),
    forms: new Map(snapshot.forms.map(item => [item.id, item] as const)),
    shells: new Map(snapshot.shells.map(item => [item.id, item] as const)),
    shellPorts: new Map(),
    watches: new Map(),
    projects: new Map(snapshot.projects.map(item => [item.id, item] as const)),
    worktrees: new Map(snapshot.worktrees.map(item => [item.projectID, item.directories] as const)),
    directoryGone
  }
}

/** The distinct directories of the snapshot's sessions (what to check before `fromSnapshot`). */
export const snapshotDirectories = (snapshot: OpenCodeSnapshot): ReadonlySet<string> =>
  new Set(snapshot.sessions.map(info => info.directory))

/** The distinct directories of every session in the model. */
export const sessionDirectories = (model: VltraModel): ReadonlySet<string> =>
  new Set(Array.from(model.sessions.values(), session => session.info.directory))

/** Session directories never checked yet (new or moved sessions). */
export const uncheckedDirectories = (model: VltraModel): ReadonlyArray<string> =>
  Array.from(sessionDirectories(model)).filter(directory => !model.directoryGone.has(directory))

/** Whether the session's folder is known to be gone from disk. */
export const isFolderGone = (model: VltraModel, session: TrackedSession): boolean =>
  model.directoryGone.get(session.info.directory) === true

/**
 * Where an `until` watch can hold a session: the folders (still on disk) of root sessions that
 * run, or whose latest run ended unhandled. A watch armed while a run is active matters once it
 * ends, and `until` only reports changes to watches, not run ends.
 */
export const mayWaitDirectories = (model: VltraModel): ReadonlySet<string> =>
  new Set(
    Array.from(model.sessions.values()).flatMap(session =>
      (session.info.parentID === undefined || !model.sessions.has(session.info.parentID)) &&
      session.info.archived === undefined &&
      model.directoryGone.get(session.info.directory) === false &&
      (session.running || !isHandled(session.info))
        ? [session.info.directory]
        : []
    )
  )

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
  model: VltraModel,
  sessionID: string,
  update: (session: TrackedSession) => TrackedSession
): VltraModel => {
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
  event: Extract<VltraEvent, { readonly _tag: 'ExecutionEnded' }>
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
 * The Vltra state machine: applies one OpenCode event to the model. Pure and idempotent for
 * events already reflected in a snapshot, so buffered events can be replayed after a resync.
 */
export const applyEvent = (model: VltraModel, event: VltraEvent): VltraModel =>
  VltraEvent.$match(event, {
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
      forms: withoutSession(model.forms, sessionID),
      shells: withoutSession(model.shells, sessionID),
      watches: withoutEntry(model.watches, sessionID)
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
    HandledChanged: ({ sessionID, handled, reopened }) =>
      updateSession(model, sessionID, session => patchInfo(session, { handled, reopened })),
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
    ShellStarted: ({ shell }) => ({ ...model, shells: withEntry(model.shells, shell.id, shell) }),
    ShellEnded: ({ shellID }) => ({
      ...model,
      shells: withoutEntry(model.shells, shellID),
      shellPorts: withoutEntry(model.shellPorts, shellID)
    }),
    WatchesLoaded: ({ watches }) => ({ ...model, watches: groupWatches(watches) }),
    WatchesChanged: ({ sessionID, watches }) => ({
      ...model,
      watches:
        watches.length === 0
          ? withoutEntry(model.watches, sessionID)
          : withEntry(model.watches, sessionID, watches)
    }),
    ShellProcessFound: ({ shellID, pid }) => {
      const shell = model.shells.get(shellID)

      return shell === undefined
        ? model
        : { ...model, shells: withEntry(model.shells, shellID, { ...shell, pid }) }
    },
    ShellsChecked: ({ ports }) => ({
      ...model,
      shellPorts: new Map(
        Array.from(model.shells.keys()).flatMap(id => {
          const known = ports.get(id) ?? model.shellPorts.get(id)

          return known === undefined ? [] : [[id, known] as const]
        })
      )
    }),
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

export const applyEvents = (model: VltraModel, events: ReadonlyArray<VltraEvent>): VltraModel =>
  events.reduce(applyEvent, model)
