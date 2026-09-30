import { Data } from 'effect'
import type {
  Outcome,
  PendingForm,
  PendingPermission,
  ProjectRecord,
  RetryInfo,
  SessionActivity,
  SessionRecord
} from '@/lib/data/fleet/types'

/**
 * Fleet's view of the OpenCode events it cares about, already decoded and narrowed at the
 * OpenCode boundary (`lib/services/opencode/events.ts`). Times are epoch milliseconds.
 */
export type FleetEvent = Data.TaggedEnum<{
  SessionUpserted: { readonly session: SessionRecord }
  SessionRemoved: { readonly sessionID: string }
  SessionRenamed: { readonly sessionID: string; readonly title: string }
  AgentSelected: { readonly sessionID: string; readonly agent: string }
  ModelSelected: { readonly sessionID: string; readonly model: string }
  UsageUpdated: { readonly sessionID: string; readonly cost: number }
  ExecutionStarted: { readonly sessionID: string; readonly at: number }
  ExecutionEnded: {
    readonly sessionID: string
    readonly at: number
    readonly outcome: Outcome
    /** Interrupted by server shutdown: OpenCode does not advance `time.idle` for these. */
    readonly shutdown: boolean
  }
  StepFailed: { readonly sessionID: string }
  RetryScheduled: { readonly sessionID: string; readonly retry: RetryInfo }
  StatusChanged: { readonly sessionID: string; readonly status: 'idle' | 'busy' | 'retry' }
  /** A step, reasoning, text, or tool call started. `callID` identifies a tool call. */
  ActivityChanged: {
    readonly sessionID: string
    readonly activity: SessionActivity
    readonly callID: string | undefined
  }
  /** A tool call's input is complete; `detail` summarises it for display. */
  ToolCalled: {
    readonly sessionID: string
    readonly callID: string
    readonly detail: string | undefined
  }
  Viewed: { readonly sessionID: string; readonly idle: number }
  PermissionAsked: { readonly permission: PendingPermission }
  PermissionReplied: { readonly requestID: string }
  FormCreated: { readonly form: PendingForm }
  FormSettled: { readonly formID: string }
  ProjectUpserted: { readonly project: ProjectRecord }
  WorktreesLoaded: { readonly projectID: string; readonly directories: ReadonlyArray<string> }
}>

export const FleetEvent = Data.taggedEnum<FleetEvent>()

/**
 * What the OpenCode event stream yields to the watcher: the stream-open marker, model events,
 * and follow-ups that need another OpenCode read before they can be applied.
 */
export type OpenCodeSignal = Data.TaggedEnum<{
  Connected: Record<never, never>
  Apply: { readonly event: FleetEvent }
  RefreshSession: { readonly sessionID: string }
  RefreshWorktrees: { readonly projectID: string }
  /** Reload the whole snapshot (for changes events cannot describe, e.g. project adoption). */
  Resync: Record<never, never>
}>

export const OpenCodeSignal = Data.taggedEnum<OpenCodeSignal>()

/** The session an event is about, when it must already be known to the model. */
export const eventSessionID = (event: FleetEvent): string | undefined =>
  FleetEvent.$match(event, {
    SessionUpserted: () => undefined,
    SessionRemoved: () => undefined,
    SessionRenamed: ({ sessionID }) => sessionID,
    AgentSelected: ({ sessionID }) => sessionID,
    ModelSelected: ({ sessionID }) => sessionID,
    UsageUpdated: ({ sessionID }) => sessionID,
    ExecutionStarted: ({ sessionID }) => sessionID,
    ExecutionEnded: ({ sessionID }) => sessionID,
    StepFailed: ({ sessionID }) => sessionID,
    RetryScheduled: ({ sessionID }) => sessionID,
    StatusChanged: ({ sessionID }) => sessionID,
    // Live activity is cosmetic and frequent: never worth a session read on its own.
    ActivityChanged: () => undefined,
    ToolCalled: () => undefined,
    Viewed: ({ sessionID }) => sessionID,
    PermissionAsked: ({ permission }) => permission.sessionID,
    PermissionReplied: () => undefined,
    FormCreated: ({ form }) => form.sessionID,
    FormSettled: () => undefined,
    ProjectUpserted: () => undefined,
    WorktreesLoaded: () => undefined
  })
