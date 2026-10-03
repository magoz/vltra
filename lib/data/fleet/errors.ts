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
