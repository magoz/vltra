import { Schema } from 'effect'

/** No OpenCode service could be discovered (or the configured endpoint is unusable). */
export class OpenCodeUnavailableError extends Schema.TaggedError<OpenCodeUnavailableError>()(
  'OpenCodeUnavailableError',
  { message: Schema.String }
) {}

/** An OpenCode HTTP call or the event stream failed. */
export class OpenCodeRequestError extends Schema.TaggedError<OpenCodeRequestError>()(
  'OpenCodeRequestError',
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown)
  }
) {}

/** The event stream ended or failed after the connection was established. */
export class OpenCodeDisconnectedError extends Schema.TaggedError<OpenCodeDisconnectedError>()(
  'OpenCodeDisconnectedError',
  { message: Schema.String }
) {}

/** OpenCode rejected an id or input Fleet passed through. */
export class OpenCodeInvalidInputError extends Schema.TaggedError<OpenCodeInvalidInputError>()(
  'OpenCodeInvalidInputError',
  { field: Schema.String, message: Schema.String }
) {}

/** The session does not exist in OpenCode. */
export class SessionNotFoundError extends Schema.TaggedError<SessionNotFoundError>()(
  'SessionNotFoundError',
  { sessionID: Schema.String }
) {}
