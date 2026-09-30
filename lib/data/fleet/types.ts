import { Schema } from 'effect'

// Wire and domain schemas for Fleet. These are the shapes served by `GET /api/fleet` and the
// `fleet.changed` SSE event, so non-browser clients (the ocb plugin) can decode them too.

/** Row state, in priority order: the first applicable state wins. */
export const FleetState = Schema.Literals(['needs-you', 'failed', 'working', 'done', 'idle'])

export type FleetState = typeof FleetState.Type

export const fleetStatePriority: ReadonlyArray<FleetState> = [
  'needs-you',
  'failed',
  'working',
  'done',
  'idle'
]

/** Outcome of the last completed execution, as recorded by OpenCode at `time.idle`. */
export const Outcome = Schema.Literals(['succeeded', 'failed', 'interrupted'])

export type Outcome = typeof Outcome.Type

/** The OpenCode session fields Fleet reads. Times are epoch milliseconds. */
export const SessionRecord = Schema.Struct({
  id: Schema.String,
  parentID: Schema.optional(Schema.String),
  projectID: Schema.String,
  directory: Schema.String,
  title: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  cost: Schema.Number,
  created: Schema.Number,
  updated: Schema.Number,
  idle: Schema.optional(Schema.Number),
  viewed: Schema.optional(Schema.Number),
  archived: Schema.optional(Schema.Number),
  outcome: Schema.optional(Outcome)
})

export type SessionRecord = typeof SessionRecord.Type

export const PendingPermission = Schema.Struct({
  id: Schema.String,
  sessionID: Schema.String,
  action: Schema.String,
  resources: Schema.Array(Schema.String),
  message: Schema.optional(Schema.String)
})

export type PendingPermission = typeof PendingPermission.Type

export const FormOption = Schema.Struct({
  value: Schema.String,
  label: Schema.String,
  description: Schema.optional(Schema.String)
})

export type FormOption = typeof FormOption.Type

/** One visibility condition: the field is active only while every condition holds. */
export const FormCondition = Schema.Struct({
  key: Schema.String,
  op: Schema.Literals(['eq', 'neq']),
  value: Schema.Union([Schema.String, Schema.Number, Schema.Boolean])
})

export type FormCondition = typeof FormCondition.Type

const formFieldBase = {
  key: Schema.String,
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  required: Schema.optional(Schema.Boolean),
  when: Schema.optional(Schema.Array(FormCondition))
}

/**
 * A form (agent question) field, as OpenCode's `Form.Field` minus validation details Fleet does not
 * enforce (OpenCode validates the answer). `external` fields link out and take no answer.
 */
export const FormField = Schema.Union([
  Schema.Struct({
    ...formFieldBase,
    type: Schema.Literal('string'),
    placeholder: Schema.optional(Schema.String),
    default: Schema.optional(Schema.String),
    options: Schema.optional(Schema.Array(FormOption)),
    /** With options: a free-text answer is allowed too. */
    custom: Schema.optional(Schema.Boolean)
  }),
  Schema.Struct({
    ...formFieldBase,
    type: Schema.Literals(['number', 'integer']),
    minimum: Schema.optional(Schema.Number),
    maximum: Schema.optional(Schema.Number),
    default: Schema.optional(Schema.Number)
  }),
  Schema.Struct({
    ...formFieldBase,
    type: Schema.Literal('boolean'),
    default: Schema.optional(Schema.Boolean)
  }),
  Schema.Struct({
    ...formFieldBase,
    type: Schema.Literal('multiselect'),
    options: Schema.Array(FormOption),
    default: Schema.optional(Schema.Array(Schema.String))
  }),
  Schema.Struct({
    key: Schema.String,
    type: Schema.Literal('external'),
    url: Schema.String,
    title: Schema.optional(Schema.String),
    description: Schema.optional(Schema.String)
  })
])

export type FormField = typeof FormField.Type

export const PendingForm = Schema.Struct({
  id: Schema.String,
  sessionID: Schema.String,
  title: Schema.String,
  fields: Schema.Array(FormField)
})

export type PendingForm = typeof PendingForm.Type

export const ProjectRecord = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  directory: Schema.String
})

export type ProjectRecord = typeof ProjectRecord.Type

export const RetryInfo = Schema.Struct({
  attempt: Schema.Number,
  at: Schema.Number,
  message: Schema.String
})

export type RetryInfo = typeof RetryInfo.Type

/**
 * What a running session is doing right now, from the live event stream only (a resync forgets
 * it until the next step): waiting on the model, writing its answer, or calling a tool.
 */
export const SessionActivity = Schema.Struct({
  kind: Schema.Literals(['thinking', 'writing', 'tool']),
  /** Tool name, for `tool`. */
  tool: Schema.optional(Schema.String),
  /** Short human-readable tool input (command, path, pattern, ...), for `tool`. */
  detail: Schema.optional(Schema.String)
})

export type SessionActivity = typeof SessionActivity.Type

export const SessionLinks = Schema.Struct({
  /** OpenCode's own web UI for this session. */
  web: Schema.String,
  /** `ocb://` URL handled by the Mac URL-scheme app. */
  terminal: Schema.String,
  /** Shell command that always works. */
  command: Schema.String
})

export type SessionLinks = typeof SessionLinks.Type

const rowFields = {
  id: Schema.String,
  parentID: Schema.optional(Schema.String),
  projectID: Schema.String,
  directory: Schema.String,
  title: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  cost: Schema.Number,
  updated: Schema.Number,
  outcome: Schema.optional(Outcome),
  idle: Schema.optional(Schema.Number),
  viewed: Schema.optional(Schema.Number),
  /** State from this session alone. */
  ownState: FleetState,
  /** State after rolling up descendants (needs-you/working propagate to ancestors). */
  state: FleetState,
  unseen: Schema.Boolean,
  running: Schema.Boolean,
  retry: Schema.optional(RetryInfo),
  /** Live activity while running (see `SessionActivity`). */
  activity: Schema.optional(SessionActivity),
  permissions: Schema.Array(PendingPermission),
  forms: Schema.Array(PendingForm),
  links: SessionLinks
}

/** A descendant (subagent) session, flattened under its root in depth-first order. */
export const FleetChildRow = Schema.Struct({
  ...rowFields,
  depth: Schema.Number
})

export type FleetChildRow = typeof FleetChildRow.Type

/** One row per root session. */
export const FleetRow = Schema.Struct({
  ...rowFields,
  /** Pending permissions and forms across the whole subtree. */
  pending: Schema.Struct({ permissions: Schema.Number, forms: Schema.Number }),
  children: Schema.Array(FleetChildRow)
})

export type FleetRow = typeof FleetRow.Type

export const WorktreeKind = Schema.Literals(['root', 'worktree', 'directory'])

export type WorktreeKind = typeof WorktreeKind.Type

export const FleetWorktree = Schema.Struct({
  directory: Schema.String,
  kind: WorktreeKind,
  rows: Schema.Array(FleetRow)
})

export type FleetWorktree = typeof FleetWorktree.Type

export const FleetProject = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  directory: Schema.String,
  worktrees: Schema.Array(FleetWorktree)
})

export type FleetProject = typeof FleetProject.Type

export const FleetCounts = Schema.Struct({
  'needs-you': Schema.Number,
  failed: Schema.Number,
  working: Schema.Number,
  done: Schema.Number,
  idle: Schema.Number
})

export type FleetCounts = typeof FleetCounts.Type

export const ConnectionStatus = Schema.Literals(['connecting', 'connected', 'disconnected'])

export type ConnectionStatus = typeof ConnectionStatus.Type

export const FleetConnection = Schema.Struct({
  status: ConnectionStatus,
  /** Epoch ms of the last status change. */
  since: Schema.Number,
  /** Consecutive failed connection attempts since the last successful connection. */
  failures: Schema.Number,
  url: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String)
})

export type FleetConnection = typeof FleetConnection.Type

/** `GET /api/fleet` body. */
export const FleetSnapshot = Schema.Struct({
  generatedAt: Schema.Number,
  connection: FleetConnection,
  counts: FleetCounts,
  projects: Schema.Array(FleetProject)
})

export type FleetSnapshot = typeof FleetSnapshot.Type

/** `fleet.changed` SSE payload: changed or added root rows, and removed root row ids. */
export const FleetChange = Schema.Struct({
  /** True for the first event of a stream; clients (re)load `GET /api/fleet` after it. */
  initial: Schema.Boolean,
  connection: FleetConnection,
  counts: FleetCounts,
  rows: Schema.Array(FleetRow),
  removed: Schema.Array(Schema.String)
})

export type FleetChange = typeof FleetChange.Type
