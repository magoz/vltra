import { Schema } from 'effect'
import { VltraState } from '@/lib/data/vltra/types'

/**
 * Only a finished root session (latest run ended, nothing pending, nothing running) can be marked
 * handled. `state` is the row's rolled-up state; absent when the session is not a root row.
 */
export class SessionNotFinishedError extends Schema.TaggedError<SessionNotFinishedError>()(
  'SessionNotFinishedError',
  { sessionID: Schema.String, state: Schema.optional(VltraState) }
) {}

/**
 * The session's folder no longer exists, so OpenCode cannot write its metadata (it resolves the
 * folder for every write). Such a session counts as handled and cannot be reopened.
 */
export class SessionFolderGoneError extends Schema.TaggedError<SessionFolderGoneError>()(
  'SessionFolderGoneError',
  { sessionID: Schema.String, directory: Schema.String }
) {}

/** The directory is not a git checkout on Box (or not the kind the call needs). */
export class NotACheckoutError extends Schema.TaggedError<NotACheckoutError>()(
  'NotACheckoutError',
  { directory: Schema.String }
) {}

/** A project's sessions are not deleted while `busy` of them are working or blocked. */
export class ProjectBusyError extends Schema.TaggedError<ProjectBusyError>()('ProjectBusyError', {
  project: Schema.String,
  busy: Schema.Number
}) {}

/** Vltra will not retire this worktree; `reason` says why (shown to the user). */
export class RetireRefusedError extends Schema.TaggedError<RetireRefusedError>()(
  'RetireRefusedError',
  { directory: Schema.String, reason: Schema.String }
) {}

/** No such launch (dismissed, expired, or lost with a restart). */
export class LaunchNotFoundError extends Schema.TaggedError<LaunchNotFoundError>()(
  'LaunchNotFoundError',
  { id: Schema.String }
) {}

/** The launch is still running; only failed or ready launches can be dismissed. */
export class LaunchInProgressError extends Schema.TaggedError<LaunchInProgressError>()(
  'LaunchInProgressError',
  { id: Schema.String }
) {}

/** A Stats range that names days that do not exist, or an unknown time zone. */
export class StatsRangeError extends Schema.TaggedError<StatsRangeError>()('StatsRangeError', {
  timezone: Schema.String
}) {}
