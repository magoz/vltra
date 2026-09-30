import { FleetEvent } from '@/lib/data/fleet/events'
import type {
  PendingForm,
  PendingPermission,
  ProjectRecord,
  RetryInfo,
  SessionRecord
} from '@/lib/data/fleet/types'

/** A session plus the live execution facts that only the event stream carries. */
export type TrackedSession = {
  readonly info: SessionRecord
  readonly running: boolean
  /** A step failed during the current or last run; cleared on the next start or when seen. */
  readonly stepFailed: boolean
  readonly retry: RetryInfo | undefined
}

/** Everything Fleet knows about OpenCode. Rebuilt from a snapshot on every (re)connect. */
export type FleetModel = {
  readonly sessions: ReadonlyMap<string, TrackedSession>
  readonly permissions: ReadonlyMap<string, PendingPermission>
  readonly forms: ReadonlyMap<string, PendingForm>
  readonly projects: ReadonlyMap<string, ProjectRecord>
  /** Saved worktree directories per project. */
  readonly worktrees: ReadonlyMap<string, ReadonlyArray<string>>
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
  worktrees: new Map()
}

const track = (info: SessionRecord, running: boolean): TrackedSession => ({
  info,
  running,
  stepFailed: false,
  retry: undefined
})

export const fromSnapshot = (snapshot: OpenCodeSnapshot): FleetModel => {
  const running = new Set(snapshot.running)

  return {
    sessions: new Map(
      snapshot.sessions.map(info => [info.id, track(info, running.has(info.id))] as const)
    ),
    permissions: new Map(snapshot.permissions.map(item => [item.id, item] as const)),
    forms: new Map(snapshot.forms.map(item => [item.id, item] as const)),
    projects: new Map(snapshot.projects.map(item => [item.id, item] as const)),
    worktrees: new Map(snapshot.worktrees.map(item => [item.projectID, item.directories] as const))
  }
}

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

const endExecution = (
  session: TrackedSession,
  event: Extract<FleetEvent, { readonly _tag: 'ExecutionEnded' }>
): TrackedSession => {
  const stopped = { ...session, running: false, stepFailed: false, retry: undefined }

  if (event.shutdown) return stopped

  const idle = session.info.idle

  // OpenCode records `time.idle = max(created, previousIdle + 1)`. A terminal event at or before
  // the known idle watermark is already reflected (for example replayed after a snapshot).
  if (idle !== undefined && event.at <= idle) return stopped

  return patchInfo(stopped, {
    idle: event.at,
    outcome: event.outcome,
    updated: Math.max(session.info.updated, event.at)
  })
}

const markViewed = (session: TrackedSession, idle: number): TrackedSession =>
  patchInfo(
    { ...session, stepFailed: false },
    { viewed: Math.max(session.info.viewed ?? idle, idle) }
  )

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
          existing === undefined ? track(session, false) : { ...existing, info: session }
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
    UsageUpdated: ({ sessionID, cost }) =>
      updateSession(model, sessionID, session => patchInfo(session, { cost })),
    ExecutionStarted: ({ sessionID, at }) =>
      updateSession(model, sessionID, session =>
        patchInfo(
          { ...session, running: true, stepFailed: false, retry: undefined },
          { updated: Math.max(session.info.updated, at) }
        )
      ),
    ExecutionEnded: ended =>
      updateSession(model, ended.sessionID, session => endExecution(session, ended)),
    StepFailed: ({ sessionID }) =>
      updateSession(model, sessionID, session => ({ ...session, stepFailed: true })),
    RetryScheduled: ({ sessionID, retry }) =>
      updateSession(model, sessionID, session => ({ ...session, running: true, retry })),
    StatusChanged: ({ sessionID, status }) =>
      updateSession(model, sessionID, session =>
        status === 'idle'
          ? { ...session, running: false, retry: undefined }
          : { ...session, running: true }
      ),
    Viewed: ({ sessionID, idle }) =>
      updateSession(model, sessionID, session => markViewed(session, idle)),
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
    })
  })

export const applyEvents = (model: FleetModel, events: ReadonlyArray<FleetEvent>): FleetModel =>
  events.reduce(applyEvent, model)
