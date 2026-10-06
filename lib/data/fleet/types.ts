import { Schema } from 'effect'

// Wire and domain schemas for Fleet. These are the shapes served by `GET /api/fleet` and the
// `fleet.changed` SSE event, so non-browser clients (the ocb plugin) can decode them too.

/**
 * Row state, in priority order: the first applicable state wins (DESIGN.md "Session state").
 *
 * - blocked: a permission or form is pending (needs me).
 * - working: a run is active.
 * - finished: the latest run ended and I have not handled it (needs me).
 * - handled: I handled the latest run, the session never ran, or its folder is gone.
 */
export const FleetState = Schema.Literals(['blocked', 'working', 'finished', 'handled'])

export type FleetState = typeof FleetState.Type

export const fleetStatePriority: ReadonlyArray<FleetState> = [
  'blocked',
  'working',
  'finished',
  'handled'
]

/** Outcome of the last completed execution, as recorded by OpenCode at `time.idle`. */
export const Outcome = Schema.Literals(['succeeded', 'failed', 'interrupted'])

export type Outcome = typeof Outcome.Type

/**
 * Why a run was interrupted (OpenCode puts it on the event only): `user` is any client's Stop,
 * `inactivity` is OpenCode stopping an evicted location's runs, `shutdown` is a server restart
 * (the run resumes), `superseded` is declared but unused in 2.0.20.
 */
export const InterruptReason = Schema.Literals(['user', 'inactivity', 'shutdown', 'superseded'])

export type InterruptReason = typeof InterruptReason.Type

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
  /** Tokens its steps read or wrote anew (cache reads left out), subagents not included. */
  tokens: Schema.Number,
  created: Schema.Number,
  /** End of the latest run; identifies the run. */
  idle: Schema.optional(Schema.Number),
  /** OpenCode's own read marker (`viewed < idle` = unread in OpenCode UIs). */
  viewed: Schema.optional(Schema.Number),
  archived: Schema.optional(Schema.Number),
  outcome: Schema.optional(Outcome),
  /** Fleet's marker (`metadata.fleet.handled`): the `idle` of the last run I handled. */
  handled: Schema.optional(Schema.Number)
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
  /** Tokens its steps read or wrote anew (cache reads left out), subagents not included. */
  tokens: Schema.Number,
  created: Schema.Number,
  /** End of the latest run (OpenCode `time.idle`); identifies the run. */
  idle: Schema.optional(Schema.Number),
  outcome: Schema.optional(Outcome),
  /** Why the latest run was interrupted, when known (`inactivity`: "stopped by OpenCode"). */
  interrupt: Schema.optional(InterruptReason),
  /** Fleet's handled marker: the `idle` of the last run I handled (handled while `>= idle`). */
  handled: Schema.optional(Schema.Number),
  /** OpenCode's read marker; Fleet never derives state from it (only for mark viewed). */
  viewed: Schema.optional(Schema.Number),
  /**
   * The session's folder no longer exists on disk (e.g. a deleted worktree or scratch folder).
   * OpenCode cannot write its metadata any more, so it counts as handled and cannot be reopened.
   */
  gone: Schema.Boolean,
  /** State from this session alone. */
  ownState: FleetState,
  /** State after rolling up descendants (blocked/working propagate to ancestors). */
  state: FleetState,
  running: Schema.Boolean,
  /** Latest scheduled retry of the current run (cleared by the next step). */
  retry: Schema.optional(RetryInfo),
  /** Live activity while running (see `SessionActivity`). */
  activity: Schema.optional(SessionActivity),
  /**
   * While running: the last step/tool/text activity (epoch ms), or when Fleet (re)connected if
   * nothing happened since. A working session quiet for `quietAfter` is stuck.
   */
  activityAt: Schema.optional(Schema.Number),
  /**
   * Recency for ordering: the latest start or activity while running, else `idle ?? created`.
   * Never OpenCode's `time.updated`, which metadata writes (handled markers) bump.
   */
  activeAt: Schema.Number,
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

/**
 * Root rows by rolled-up state (needs me = blocked + finished). `stuck` counts working rows that
 * are retrying or quiet; it overlaps `working`.
 */
export const FleetCounts = Schema.Struct({
  blocked: Schema.Number,
  finished: Schema.Number,
  working: Schema.Number,
  stuck: Schema.Number,
  handled: Schema.Number
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

/**
 * A launch's progress (DESIGN.md "Launcher and worktrees"): OpenCode provisions the worktree,
 * then Fleet creates the session and sends the task; `failed` at any step.
 */
export const LaunchStatus = Schema.Literals(['provisioning', 'creating-session', 'ready', 'failed'])

export type LaunchStatus = typeof LaunchStatus.Type

/**
 * A new worktree + session the launcher started, tracked in Fleet's memory (lost on restart).
 * Listed until dismissed, or for 10 minutes once ready.
 */
export const Launch = Schema.Struct({
  id: Schema.String,
  /** The repository's primary checkout. */
  repo: Schema.String,
  repoName: Schema.String,
  branch: Schema.String,
  task: Schema.String,
  status: LaunchStatus,
  /** The new worktree, once OpenCode returned it. */
  directory: Schema.optional(Schema.String),
  /** The new session, once created. */
  sessionID: Schema.optional(Schema.String),
  /** Why it failed (OpenCode's sanitized message). */
  error: Schema.optional(Schema.String),
  /** What a failure left behind (the worktree, the session), if anything. */
  preserved: Schema.optional(Schema.String),
  startedAt: Schema.Number,
  /** Last status change. */
  updatedAt: Schema.Number
})

export type Launch = typeof Launch.Type

/** `GET /api/fleet` body. */
export const FleetSnapshot = Schema.Struct({
  generatedAt: Schema.Number,
  connection: FleetConnection,
  counts: FleetCounts,
  projects: Schema.Array(FleetProject),
  /** Launches in progress, failed, or recently ready, oldest first. */
  launches: Schema.Array(Launch)
})

export type FleetSnapshot = typeof FleetSnapshot.Type

/** `fleet.changed` SSE payload: changed or added root rows, and removed root row ids. */
export const FleetChange = Schema.Struct({
  /** True for the first event of a stream; clients (re)load `GET /api/fleet` after it. */
  initial: Schema.Boolean,
  connection: FleetConnection,
  counts: FleetCounts,
  rows: Schema.Array(FleetRow),
  removed: Schema.Array(Schema.String),
  /** Every launch, when any changed (and in the initial event); absent otherwise. */
  launches: Schema.optional(Schema.Array(Launch))
})

export type FleetChange = typeof FleetChange.Type

/** One line of a session's recent transcript, as read from OpenCode. */
export const TranscriptEntry = Schema.Struct({
  id: Schema.String,
  role: Schema.Literals(['user', 'agent', 'tool', 'shell', 'error', 'note']),
  text: Schema.String,
  at: Schema.Number,
  /** Tool and shell entries: whether the call is still running, finished, or failed. */
  status: Schema.optional(Schema.Literals(['running', 'completed', 'error']))
})

export type TranscriptEntry = typeof TranscriptEntry.Type

/** The tail of a session's transcript, oldest first, and its latest final answer text. */
export const Transcript = Schema.Struct({
  entries: Schema.Array(TranscriptEntry),
  answer: Schema.optional(Schema.String)
})

export type Transcript = typeof Transcript.Type

export const FileChange = Schema.Struct({
  file: Schema.String,
  additions: Schema.Number,
  deletions: Schema.Number,
  status: Schema.Literals(['added', 'deleted', 'modified'])
})

export type FileChange = typeof FileChange.Type

export const ChangeTotals = Schema.Struct({
  files: Schema.Number,
  additions: Schema.Number,
  deletions: Schema.Number
})

export type ChangeTotals = typeof ChangeTotals.Type

/** `GET /api/fleet/sessions/:id/summary?idle=`: a finished run's answer excerpt and change totals. */
export const SessionSummary = Schema.Struct({
  sessionID: Schema.String,
  idle: Schema.Number,
  answer: Schema.optional(Schema.String),
  changes: Schema.optional(ChangeTotals)
})

export type SessionSummary = typeof SessionSummary.Type

/**
 * Who manages a linked worktree: `dotfiles` when it carries the dotfiles `worktrees` plugin's
 * ownership marker for its current branch (created by OpenCode/Fleet, retirable from Fleet),
 * `other` for Pi/Herdr and plain `git worktree add` checkouts.
 */
export const WorktreeOwner = Schema.Literals(['dotfiles', 'other'])

export type WorktreeOwner = typeof WorktreeOwner.Type

/** A linked worktree of a repository, as git lists it. */
export const RepoWorktree = Schema.Struct({
  directory: Schema.String,
  /** Checked-out branch; absent when detached. */
  branch: Schema.optional(Schema.String),
  owner: WorktreeOwner
})

export type RepoWorktree = typeof RepoWorktree.Type

/** A git repository's primary checkout on Box and its linked worktrees. */
export const RepoCheckout = Schema.Struct({
  name: Schema.String,
  /** Canonical (real) path of the primary checkout. */
  directory: Schema.String,
  worktrees: Schema.Array(RepoWorktree)
})

export type RepoCheckout = typeof RepoCheckout.Type

/**
 * A worktree branch's pull request, from `gh` on Box: `unknown` when the lookup failed (or is
 * still running), `none` when the branch has no PR.
 */
/** An issue a pull request closes (GitHub's closing references: "Closes #12", linked issues). */
export const ClosingIssue = Schema.Struct({ number: Schema.Number, url: Schema.String })

export type ClosingIssue = typeof ClosingIssue.Type

export const PullRequest = Schema.Struct({
  state: Schema.Literals(['unknown', 'none', 'open', 'merged', 'closed']),
  number: Schema.optional(Schema.Number),
  url: Schema.optional(Schema.String),
  /** The issues it closes, when it has any. */
  issues: Schema.optional(Schema.Array(ClosingIssue))
})

export type PullRequest = typeof PullRequest.Type

/** Root sessions in one checkout, by rolled-up state. */
export const SessionTally = Schema.Struct({
  blocked: Schema.Number,
  working: Schema.Number,
  finished: Schema.Number,
  handled: Schema.Number
})

export type SessionTally = typeof SessionTally.Type

const checkoutFields = {
  directory: Schema.String,
  sessions: SessionTally,
  /** The newest root session there (by `activeAt`): what opening the checkout resumes. */
  latestSession: Schema.optional(Schema.String),
  /** Latest agent activity of its root sessions. */
  activeAt: Schema.optional(Schema.Number)
}

export const LauncherWorktree = Schema.Struct({
  ...checkoutFields,
  branch: Schema.optional(Schema.String),
  owner: WorktreeOwner,
  pr: PullRequest
})

export type LauncherWorktree = typeof LauncherWorktree.Type

/**
 * One repository in the launcher: its primary checkout (`sessions`, `latestSession` and
 * `activeAt` are the primary's own; sessions in subfolders count too) and its linked worktrees.
 */
export const LauncherEntry = Schema.Struct({
  ...checkoutFields,
  name: Schema.String,
  /** OpenCode's project for the repository, when OpenCode has opened it. */
  projectID: Schema.optional(Schema.String),
  worktrees: Schema.Array(LauncherWorktree),
  /** Latest agent activity across the primary and every worktree (the launcher's order). */
  lastActivity: Schema.optional(Schema.Number)
})

export type LauncherEntry = typeof LauncherEntry.Type

/** `GET /api/fleet/launcher`: repositories by most recent agent activity, then by name. */
export const LauncherList = Schema.Struct({
  generatedAt: Schema.Number,
  entries: Schema.Array(LauncherEntry)
})

export type LauncherList = typeof LauncherList.Type

/** A branch suggestion: from the model, or the deterministic fallback slug. */
export const BranchSuggestion = Schema.Struct({
  branch: Schema.String,
  source: Schema.Literals(['model', 'fallback'])
})

export type BranchSuggestion = typeof BranchSuggestion.Type

// Fleet's JSON mutation routes (DESIGN.md "Fleet API"), for the terminal plugin: the same Effects
// and validation as the web's server actions. Request bodies are `EmptyRequest` (ids travel in the
// path), `LaunchInput` and `OpenCheckoutInput` (`launcher.ts`); every route answers `200` with its
// result below, or `ApiFailure` with a 4xx/5xx status.

/** Body of the mutation routes that take no input: `{}`. */
export const EmptyRequest = Schema.Struct({})

export type EmptyRequest = typeof EmptyRequest.Type

/** Error body of the JSON routes: the server actions' user-safe message. */
export const ApiFailure = Schema.Struct({ error: Schema.String })

export type ApiFailure = typeof ApiFailure.Type

export const MarkHandledOutcome = Schema.Literals(['handled', 'already-handled'])

export type MarkHandledOutcome = typeof MarkHandledOutcome.Type

export const ReopenOutcome = Schema.Literals(['reopened', 'not-handled'])

export type ReopenOutcome = typeof ReopenOutcome.Type

/** `POST /api/fleet/sessions/:id/handled`: `already-handled` when there was nothing to write. */
export const HandledResult = Schema.Struct({
  sessionID: Schema.String,
  outcome: MarkHandledOutcome
})

export type HandledResult = typeof HandledResult.Type

/** `POST /api/fleet/sessions/:id/reopen`: `not-handled` when there was no marker to remove. */
export const ReopenResult = Schema.Struct({ sessionID: Schema.String, outcome: ReopenOutcome })

export type ReopenResult = typeof ReopenResult.Type

/** `POST /api/fleet/launches`: the launch's id; its progress arrives in `launches`. */
export const LaunchStarted = Schema.Struct({ launchID: Schema.String })

export type LaunchStarted = typeof LaunchStarted.Type

/** `POST /api/fleet/launches/:id/dismiss`. */
export const LaunchDismissed = Schema.Struct({ launchID: Schema.String })

export type LaunchDismissed = typeof LaunchDismissed.Type

/**
 * `POST /api/fleet/checkouts/open` (and the `openCheckout` action): the checkout's latest root
 * session, or a new empty one (`created`).
 */
export const OpenedCheckout = Schema.Struct({ sessionID: Schema.String, created: Schema.Boolean })

export type OpenedCheckout = typeof OpenedCheckout.Type

/** One account's quota window in a usage pool. */
export const UsageWindow = Schema.Struct({
  account: Schema.String,
  label: Schema.String,
  left: Schema.Number,
  resetsAt: Schema.optional(Schema.Number)
})

export type UsageWindow = typeof UsageWindow.Type

/**
 * How much a pool has left, each reporting account counting 100%: two accounts at 6% and 100% are
 * `{ left: 106, capacity: 200 }`.
 */
export const UsageReading = Schema.Struct({
  /** Sum over the reporting accounts of each one's tightest window (the one that runs out first). */
  left: Schema.Number,
  /** 100 per reporting account. */
  capacity: Schema.Number
})

export type UsageReading = typeof UsageReading.Type

/** A provider's subscription quota: Claude, Codex (pooled accounts), Go. */
export const UsagePool = Schema.Struct({
  provider: Schema.String,
  name: Schema.String,
  /** Absent when no account reports. */
  reading: Schema.optional(UsageReading),
  /** The first of the pool's accounts' weekly resets (epoch ms); absent when none says. */
  weeklyResetAt: Schema.optional(Schema.Number),
  /** Some reading is the last good one (a refresh failed). */
  stale: Schema.Boolean,
  windows: Schema.Array(UsageWindow)
})

export type UsagePool = typeof UsagePool.Type

/** `GET /api/fleet/usage`: the subscription quotas, one pool per provider. */
export const UsageSummary = Schema.Struct({ pools: Schema.Array(UsagePool) })

export type UsageSummary = typeof UsageSummary.Type

/** A browser that gets Fleet's notifications (Web Push), as Settings lists it. */
export const PushDevice = Schema.Struct({
  /** Derived from its push endpoint, which never leaves the server. */
  id: Schema.String,
  /** `iPhone · app`, `Mac · Chrome`: the browser that turned them on says. */
  label: Schema.String,
  createdAt: Schema.Number
})

export type PushDevice = typeof PushDevice.Type

/** `GET /api/fleet/notifications`: the key browsers subscribe with, and every subscribed device. */
export const PushSettings = Schema.Struct({
  /** The VAPID public key (URL-safe base64), `applicationServerKey` for `pushManager.subscribe`. */
  publicKey: Schema.String,
  devices: Schema.Array(PushDevice)
})

export type PushSettings = typeof PushSettings.Type

/** Tokens as OpenCode records them per assistant step (cache reads dwarf the rest). */
export const TokenCounts = Schema.Struct({
  input: Schema.Number,
  output: Schema.Number,
  reasoning: Schema.Number,
  cacheRead: Schema.Number,
  cacheWrite: Schema.Number
})

export type TokenCounts = typeof TokenCounts.Type

/** Tool calls by status: `unfinished` were still running (or never ended) when read. */
export const ToolTotals = Schema.Struct({
  calls: Schema.Number,
  succeeded: Schema.Number,
  failed: Schema.Number,
  unfinished: Schema.Number
})

export type ToolTotals = typeof ToolTotals.Type

export const ToolUsage = Schema.Struct({
  name: Schema.String,
  calls: Schema.Number,
  succeeded: Schema.Number,
  failed: Schema.Number,
  unfinished: Schema.Number,
  /** Median duration in ms of the calls that ended. */
  durationP50: Schema.optional(Schema.Number)
})

export type ToolUsage = typeof ToolUsage.Type

/** One model's share: `provider/model`, with `#variant` when the step named one. */
export const ModelUsage = Schema.Struct({
  model: Schema.String,
  steps: Schema.Number,
  tokens: TokenCounts
})

export type ModelUsage = typeof ModelUsage.Type

/** Steps on one calendar day (`YYYY-MM-DD` in the query's time zone). */
export const DayActivity = Schema.Struct({ date: Schema.String, steps: Schema.Number })

export type DayActivity = typeof DayActivity.Type

/**
 * OpenCode's activity in a time range (`GET /api/experimental/session/stats`), counted from the
 * messages created in it: sessions and subagents with any message, prompts (root sessions' user
 * messages), steps (assistant messages) and their tokens, tool calls; days in OpenCode's
 * time zone. `tools` per tool only when asked for in detail.
 */
export const SessionStats = Schema.Struct({
  from: Schema.Number,
  to: Schema.Number,
  sessions: Schema.Number,
  subagents: Schema.Number,
  prompts: Schema.Number,
  steps: Schema.Number,
  tokens: TokenCounts,
  activeDays: Schema.Number,
  /** Longest run of consecutive active days in the range. */
  streak: Schema.Number,
  toolTotals: ToolTotals,
  tools: Schema.Array(ToolUsage),
  models: Schema.Array(ModelUsage),
  /** Days with any step, in order. */
  activity: Schema.Array(DayActivity)
})

export type SessionStats = typeof SessionStats.Type

/** A Stats chart's bucket size: hours up to two days, days up to 92, then weeks (from Monday). */
export const StatsUnit = Schema.Literals(['hour', 'day', 'week'])

export type StatsUnit = typeof StatsUnit.Type

/** One bar of the Stats charts: `[start, end)`, clipped to the range. */
export const StatsBucket = Schema.Struct({
  start: Schema.Number,
  end: Schema.Number,
  sessions: Schema.Number,
  subagents: Schema.Number,
  prompts: Schema.Number,
  steps: Schema.Number,
  tokens: TokenCounts,
  tools: ToolTotals,
  models: Schema.Array(ModelUsage)
})

export type StatsBucket = typeof StatsBucket.Type

/**
 * `GET /api/fleet/stats`: OpenCode's stats for the whole range (`totals`, tools in detail) and per
 * bucket, in the browser's time zone. `from` is OpenCode's first message for "all time".
 */
export const StatsReport = Schema.Struct({
  from: Schema.Number,
  to: Schema.Number,
  unit: StatsUnit,
  timezone: Schema.String,
  totals: SessionStats,
  /** The as long range just before (none for all time), for the tiles' change. */
  previous: Schema.optional(SessionStats),
  buckets: Schema.Array(StatsBucket)
})

export type StatsReport = typeof StatsReport.Type

/** Prompts sent in one hour of the range (the first and last hours clipped to it). */
export const HourActivity = Schema.Struct({ start: Schema.Number, prompts: Schema.Number })

export type HourActivity = typeof HourActivity.Type

/**
 * `GET /api/fleet/stats/hours`: prompts per hour, for the time-of-day charts; `TooLong` past 31
 * days (and for all time), where one OpenCode call per hour would cost too much.
 */
export const HoursRead = Schema.TaggedStruct('Hours', {
  from: Schema.Number,
  to: Schema.Number,
  timezone: Schema.String,
  hours: Schema.Array(HourActivity)
})

export const HoursTooLong = Schema.TaggedStruct('TooLong', {})

export const StatsHours = Schema.Union([HoursRead, HoursTooLong])

export type StatsHours = typeof StatsHours.Type

/**
 * `GET /api/fleet/stats/calendar`: steps per day over the last 53 weeks (from a Monday), whatever
 * the range; days without any left out.
 */
export const StatsCalendar = Schema.Struct({
  from: Schema.Number,
  to: Schema.Number,
  timezone: Schema.String,
  days: Schema.Array(DayActivity)
})

export type StatsCalendar = typeof StatsCalendar.Type

/** One bar of all projects' prompts. */
export const PromptBucket = Schema.Struct({
  start: Schema.Number,
  end: Schema.Number,
  prompts: Schema.Number
})

export type PromptBucket = typeof PromptBucket.Type

/** One OpenCode project's prompts per bar. */
export const ProjectPromptSeries = Schema.Struct({
  projectID: Schema.String,
  prompts: Schema.Array(Schema.Number)
})

export type ProjectPromptSeries = typeof ProjectPromptSeries.Type

/**
 * `GET /api/fleet/stats/projects`: prompts per bar for all projects and for the five projects with
 * most prompts in the range (most first), whatever `?project=`; the rest is the difference.
 */
export const PromptsByProject = Schema.Struct({
  from: Schema.Number,
  to: Schema.Number,
  unit: StatsUnit,
  timezone: Schema.String,
  buckets: Schema.Array(PromptBucket),
  projects: Schema.Array(ProjectPromptSeries)
})

export type PromptsByProject = typeof PromptsByProject.Type
