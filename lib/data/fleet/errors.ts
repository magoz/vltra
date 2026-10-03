import { Schema } from 'effect'
import { FleetState } from '@/lib/data/fleet/types'

/**
 * Only a finished root session (latest run ended, nothing pending, nothing running) can be marked
 * handled. `state` is the row's rolled-up state; absent when the session is not a root row.
 */
export class SessionNotFinishedError extends Schema.TaggedError<SessionNotFinishedError>()(
  'SessionNotFinishedError',
  { sessionID: Schema.String, state: Schema.optional(FleetState) }
) {}

/**
 * The session's folder no longer exists, so OpenCode cannot write its metadata (it resolves the
 * folder for every write). Such a session counts as handled and cannot be reopened.
 */
export class SessionFolderGoneError extends Schema.TaggedError<SessionFolderGoneError>()(
  'SessionFolderGoneError',
  { sessionID: Schema.String, directory: Schema.String }
) {}
