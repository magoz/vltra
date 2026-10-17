import { DateTime, Option, Predicate, Schema } from 'effect'
import type { Effect, Stream } from 'effect'
import type {
  Form,
  Location,
  Model,
  OpenCodeClient,
  OpenCodeEvent,
  Permission,
  Project,
  Session,
  SessionMessage
} from '@opencode/client/effect'
import { VltraEvent, OpenCodeSignal } from '@/lib/data/vltra/events'
import type { ResolvedLocation } from '@/lib/services/opencode/service'
import type {
  FileChange,
  FormField,
  InterruptReason,
  Outcome,
  PendingForm,
  PendingPermission,
  ProjectRecord,
  SessionRecord,
  SessionStats,
  TokenCounts,
  Transcript,
  TranscriptEntry
} from '@/lib/data/vltra/types'

// OpenCode (v2.0.20 schema) → Vltra domain types. Everything OpenCode-shaped stops here.

const millis = (value: DateTime.Utc | undefined) =>
  value === undefined ? undefined : DateTime.toEpochMillis(value)

export const modelLabel = (model: Model.Ref): string => `${model.providerID}/${model.id}`

const HandledMarker = Schema.Struct({ handled: Schema.Finite })

/** Vltra's own metadata key; everything else in `metadata` belongs to other writers. */
const VltraMetadata = Schema.Struct({ vltra: HandledMarker })

/**
 * The marker's key from before the rename (Fleet). Read, never written: every write drops it, and
 * `pnpm vltra:migrate-handled` moved the rest (2026-10-17; only folder-gone sessions, which read
 * as handled regardless, kept the old key), so this fallback can go.
 */
const LegacyMetadata = Schema.Struct({ fleet: HandledMarker })

const decodeVltraMetadata = Schema.decodeUnknownOption(VltraMetadata)

const decodeLegacyMetadata = Schema.decodeUnknownOption(LegacyMetadata)

const isJsonObject = Schema.is(Schema.Record(Schema.String, Schema.Json))

/**
 * `metadata.vltra.handled`, else the legacy `metadata.fleet.handled`, when present and a number;
 * anything else reads as unhandled.
 */
export const vltraHandled = (metadata: Session.Metadata | undefined): number | undefined =>
  Option.getOrUndefined(
    Option.orElse(
      Option.map(decodeVltraMetadata(metadata), value => value.vltra.handled),
      () => Option.map(decodeLegacyMetadata(metadata), value => value.fleet.handled)
    )
  )

/**
 * The whole metadata object to write back (OpenCode replaces it): every other key kept, only
 * `vltra.handled` replaced, or removed for `undefined` (and `vltra` dropped once empty). The legacy
 * `fleet` key is always dropped.
 */
export const withVltraHandled = (
  metadata: Session.Metadata | undefined,
  handled: number | undefined
): Session.Metadata => {
  const source: Session.Metadata = metadata ?? {}
  const { vltra, fleet: _legacy, ...others } = source
  const { handled: _previous, ...kept } = isJsonObject(vltra) ? vltra : {}
  const next = handled === undefined ? kept : { ...kept, handled }

  return Object.keys(next).length === 0 ? others : { ...others, vltra: next }
}

type OpenCodeTokens = Session.Info['tokens']

/** Tokens read or written anew: all but cache reads (Vltra's `freshTokens`). */
export const freshTokenCount = (tokens: OpenCodeTokens): number =>
  tokens.input + tokens.output + tokens.reasoning + tokens.cache.write

export const toSessionRecord = (info: Session.Info): SessionRecord => ({
  id: info.id,
  parentID: info.parentID,
  projectID: info.projectID,
  directory: info.location.directory,
  title: info.title,
  agent: info.agent,
  model: info.model === undefined ? undefined : modelLabel(info.model),
  cost: info.cost,
  tokens: freshTokenCount(info.tokens),
  created: DateTime.toEpochMillis(info.time.created),
  idle: millis(info.time.idle),
  viewed: millis(info.time.viewed),
  archived: millis(info.time.archived),
  outcome: info.outcome,
  handled: vltraHandled(info.metadata)
})

export const toPendingPermission = (request: Permission.Request): PendingPermission => ({
  id: request.id,
  sessionID: request.sessionID,
  action: request.action,
  resources: request.resources,
  message: request.message
})

const fieldBase = (field: Exclude<Form.Field, Form.ExternalField>) => ({
  key: field.key,
  title: field.title,
  description: field.description,
  required: field.required,
  when: field.when
})

export const toFormField = (field: Form.Field): FormField => {
  switch (field.type) {
    case 'string':
      return {
        ...fieldBase(field),
        type: 'string',
        placeholder: field.placeholder,
        default: field.default,
        options: field.options,
        custom: field.custom
      }
    case 'number':
    case 'integer':
      return {
        ...fieldBase(field),
        type: field.type,
        minimum: field.minimum,
        maximum: field.maximum,
        default: field.default
      }
    case 'boolean':
      return { ...fieldBase(field), type: 'boolean', default: field.default }
    case 'multiselect':
      return {
        ...fieldBase(field),
        type: 'multiselect',
        options: field.options,
        default: field.default
      }
    case 'external':
      return {
        key: field.key,
        type: 'external',
        url: field.url,
        title: field.title,
        description: field.description
      }
  }
}

export const toPendingForm = (form: Form.Info): PendingForm => ({
  id: form.id,
  sessionID: form.sessionID,
  title: form.title,
  // Hidden fields take their default unless answered; Vltra does not ask for them.
  fields: form.fields.flatMap(field =>
    field.type !== 'external' && field.hidden === true ? [] : [toFormField(field)]
  )
})

/** OpenCode's own tool input type (`session.tool.called`). */
type ToolInput = Extract<OpenCodeEvent, { readonly type: 'session.tool.called' }>['data']['input']

const detailKeys = ['command', 'description', 'filePath', 'path', 'pattern', 'url', 'query']

const detailLimit = 120

/**
 * A short, human-readable summary of a tool call's input (the command, path, pattern, ...), for
 * the dashboard's live activity. Unknown inputs yield nothing.
 */
export const toolDetail = (input: ToolInput): string | undefined => {
  for (const key of detailKeys) {
    const value = input[key]

    if (Predicate.isString(value) && value.trim() !== '') {
      const line = value.trim().split('\n')[0] ?? ''

      return line.length > detailLimit ? `${line.slice(0, detailLimit - 1)}…` : line
    }
  }

  return undefined
}

export const toProjectRecord = (project: Project.Info): ProjectRecord => ({
  id: project.id,
  name: project.name,
  directory: project.canonical
})

export const toResolvedLocation = (info: Location.PublicInfo): ResolvedLocation => ({
  directory: info.directory,
  projectID: info.project.id,
  projectDirectory: info.project.canonical
})

/** Longest OpenCode refusal shown to the user. */
const refusalLimit = 400

/**
 * OpenCode's refusal text made safe to show: no terminal escapes or control characters, one line
 * of collapsed whitespace, clipped.
 */
export const sanitizeMessage = (message: string): string =>
  clip(
    message
      .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
    refusalLimit
  )

/** The worktree group's error body: `{ name: 'WorktreeError', data: { message } }`. */
const WorktreeFailure = Schema.Struct({
  name: Schema.Literal('WorktreeError'),
  data: Schema.Struct({ message: Schema.String })
})

/** Protocol errors that carry a message meant for the caller. */
const RequestFailure = Schema.Struct({
  _tag: Schema.Literals(['InvalidRequestError', 'ProjectNotFoundError', 'ConflictError']),
  message: Schema.String
})

const decodeWorktreeFailure = Schema.decodeUnknownOption(WorktreeFailure)

const decodeRequestFailure = Schema.decodeUnknownOption(RequestFailure)

/**
 * The message of an OpenCode refusal (a worktree error such as the dotfiles plugin's preflight or
 * retirement refusal, an invalid request, an unknown project), sanitized. None for transport
 * failures, timeouts and anything else.
 */
export const refusalMessage = (cause: unknown): Option.Option<string> =>
  decodeWorktreeFailure(cause).pipe(
    Option.map(failure => failure.data.message),
    Option.orElse(() => Option.map(decodeRequestFailure(cause), failure => failure.message)),
    Option.map(sanitizeMessage),
    Option.filter(message => message !== '')
  )

const apply = (event: VltraEvent): ReadonlyArray<OpenCodeSignal> => [
  OpenCodeSignal.Apply({ event })
]

const entryLimit = 1500

const clip = (text: string, limit = entryLimit) =>
  text.length > limit ? `${text.slice(0, limit - 1)}…` : text

const toolEntryStatus = (state: SessionMessage.ToolState): TranscriptEntry['status'] => {
  switch (state.status) {
    case 'streaming':
    case 'running':
      return 'running'
    case 'completed':
      return 'completed'
    case 'error':
      return 'error'
  }
}

const toolInput = (state: SessionMessage.ToolState): ToolInput =>
  state.status === 'streaming' ? {} : state.input

const assistantEntries = (message: SessionMessage.Assistant): ReadonlyArray<TranscriptEntry> => {
  const at = DateTime.toEpochMillis(message.time.created)

  const entries = message.content.flatMap((part, index): ReadonlyArray<TranscriptEntry> => {
    switch (part.type) {
      case 'text':
        return part.text.trim() === ''
          ? []
          : [{ id: `${message.id}:${index}`, role: 'agent', text: clip(part.text.trim()), at }]
      case 'tool': {
        const detail = toolDetail(toolInput(part.state))

        return [
          {
            id: `${message.id}:${index}`,
            role: 'tool',
            text: detail === undefined ? part.name : `${part.name} · ${detail}`,
            at,
            status: toolEntryStatus(part.state)
          }
        ]
      }

      case 'reasoning':
        return []
    }
  })

  return message.error === undefined
    ? entries
    : [
        ...entries,
        { id: `${message.id}:error`, role: 'error', text: clip(message.error.message), at }
      ]
}

const shellStatus = (status: SessionMessage.Shell['status']): TranscriptEntry['status'] => {
  switch (status) {
    case 'running':
      return 'running'
    case 'exited':
      return 'completed'
    case 'timeout':
    case 'killed':
      return 'error'
  }
}

const messageEntries = (message: SessionMessage.Info): ReadonlyArray<TranscriptEntry> => {
  const at = DateTime.toEpochMillis(message.time.created)

  switch (message.type) {
    case 'user':
      return [{ id: message.id, role: 'user', text: clip(message.text), at }]
    case 'assistant':
      return assistantEntries(message)
    case 'shell':
      return [
        {
          id: message.id,
          role: 'shell',
          text: clip(`$ ${message.command}`, 300),
          at,
          status: shellStatus(message.status)
        }
      ]
    case 'compaction':
      return [{ id: message.id, role: 'note', text: 'Context compacted', at }]
    case 'idle':
      return message.outcome === 'succeeded'
        ? []
        : [{ id: message.id, role: 'note', text: `Run ${message.outcome}`, at }]
    case 'agent-switched':
    case 'model-switched':
    case 'location-switched':
    case 'synthetic':
    case 'system':
    case 'skill':
      return []
  }
}

/** The newest assistant text in `messages` (any order), i.e. the latest final answer. */
const latestAnswer = (messages: ReadonlyArray<SessionMessage.Info>): string | undefined => {
  const newestFirst = messages.toSorted(
    (left, right) =>
      DateTime.toEpochMillis(right.time.created) - DateTime.toEpochMillis(left.time.created)
  )

  for (const message of newestFirst) {
    if (message.type !== 'assistant') continue

    const text = message.content
      .flatMap(part => (part.type === 'text' ? [part.text.trim()] : []))
      .filter(part => part !== '')
      .join('\n\n')

    if (text !== '') return clip(text)
  }

  return undefined
}

/**
 * A bounded transcript tail: `messages` as returned by OpenCode (any order), oldest first, at
 * most `limit` entries, each clipped.
 */
export const toTranscript = (
  messages: ReadonlyArray<SessionMessage.Info>,
  limit: number
): Transcript => {
  const entries = messages
    .toSorted(
      (left, right) =>
        DateTime.toEpochMillis(left.time.created) - DateTime.toEpochMillis(right.time.created)
    )
    .flatMap(messageEntries)

  return { entries: entries.slice(-limit), answer: latestAnswer(messages) }
}

type FileDiffInfo = Effect.Success<ReturnType<OpenCodeClient['session']['diff']>>[number]

export const toFileChange = (diff: FileDiffInfo): FileChange => ({
  file: diff.file,
  additions: diff.additions,
  deletions: diff.deletions,
  status: diff.status
})

type StatsOutput = Effect.Success<ReturnType<OpenCodeClient['session']['stats']>>

const toTokenCounts = (tokens: StatsOutput['tokens']): TokenCounts => ({
  input: tokens.input,
  output: tokens.output,
  reasoning: tokens.reasoning,
  cacheRead: tokens.cache.read,
  cacheWrite: tokens.cache.write
})

const variantLabel = (model: Model.Ref): string =>
  model.variant === undefined ? modelLabel(model) : `${modelLabel(model)}#${model.variant}`

/** `session.stats`; tool totals are zero and the per-tool list empty for `tools: 'none'`. */
export const toSessionStats = (stats: StatsOutput): SessionStats => ({
  from: DateTime.toEpochMillis(stats.range.from),
  to: DateTime.toEpochMillis(stats.range.to),
  sessions: stats.sessions,
  subagents: stats.subagents,
  prompts: stats.prompts,
  steps: stats.steps,
  tokens: toTokenCounts(stats.tokens),
  activeDays: stats.activeDays,
  streak: stats.streak,
  toolTotals:
    stats.tools.mode === 'none'
      ? { calls: 0, succeeded: 0, failed: 0, unfinished: 0 }
      : stats.tools.totals,
  tools:
    stats.tools.mode === 'detail'
      ? stats.tools.usage.map(tool => ({
          name: tool.name,
          calls: tool.calls,
          succeeded: tool.succeeded,
          failed: tool.failed,
          unfinished: tool.unfinished,
          durationP50: tool.durationP50
        }))
      : [],
  models: stats.models.map(entry => ({
    model: variantLabel(entry.model),
    steps: entry.steps,
    tokens: toTokenCounts(entry.tokens)
  }))
})

type SessionLogItem = Stream.Success<ReturnType<OpenCodeClient['session']['log']>>

/** How a run ended, as recorded in the session's durable log. */
export type RunEnd = { readonly outcome: Outcome; readonly reason: InterruptReason | undefined }

/**
 * Folds a session's durable log (`session.log`) to the end of its latest run: the last terminal
 * execution event that stamped `time.idle` (shutdown interruptions do not). Log items are the
 * same durable events the live stream carries, so either can be folded.
 */
export const latestRunEnd = (
  latest: RunEnd | undefined,
  item: SessionLogItem | OpenCodeEvent
): RunEnd | undefined => {
  switch (item.type) {
    case 'session.execution.succeeded':
      return { outcome: 'succeeded', reason: undefined }
    case 'session.execution.failed':
      return { outcome: 'failed', reason: undefined }
    case 'session.execution.interrupted':
      return item.data.reason === 'shutdown'
        ? latest
        : { outcome: 'interrupted', reason: item.data.reason }
    default:
      return latest
  }
}

/**
 * Narrows one OpenCode event to the Vltra signals it implies. Events Vltra does not track
 * (text deltas, tool calls, config updates, ...) map to nothing.
 */
export const toSignals = (event: OpenCodeEvent): ReadonlyArray<OpenCodeSignal> => {
  switch (event.type) {
    case 'server.connected':
      return [OpenCodeSignal.Connected()]
    case 'session.created':
    case 'session.moved':
    case 'session.forked':
      // Created/imported/forked/moved sessions carry partial data; read the stored row.
      return [OpenCodeSignal.RefreshSession({ sessionID: event.data.sessionID })]
    case 'session.deleted':
      return apply(VltraEvent.SessionRemoved({ sessionID: event.data.sessionID }))
    case 'session.renamed':
      return apply(
        VltraEvent.SessionRenamed({ sessionID: event.data.sessionID, title: event.data.title })
      )
    case 'session.agent.selected':
      return apply(
        VltraEvent.AgentSelected({ sessionID: event.data.sessionID, agent: event.data.agent })
      )
    case 'session.model.selected':
      return apply(
        VltraEvent.ModelSelected({
          sessionID: event.data.sessionID,
          model: modelLabel(event.data.model)
        })
      )
    case 'session.usage.updated':
      return apply(
        VltraEvent.UsageUpdated({
          sessionID: event.data.sessionID,
          cost: event.data.cost,
          tokens: freshTokenCount(event.data.tokens)
        })
      )
    case 'session.execution.started':
      return apply(
        VltraEvent.ExecutionStarted({ sessionID: event.data.sessionID, at: event.created })
      )
    case 'session.execution.succeeded':
      return apply(
        VltraEvent.ExecutionEnded({
          sessionID: event.data.sessionID,
          at: event.created,
          outcome: 'succeeded',
          reason: undefined
        })
      )
    case 'session.execution.failed':
      return apply(
        VltraEvent.ExecutionEnded({
          sessionID: event.data.sessionID,
          at: event.created,
          outcome: 'failed',
          reason: undefined
        })
      )
    case 'session.execution.interrupted':
      return apply(
        VltraEvent.ExecutionEnded({
          sessionID: event.data.sessionID,
          at: event.created,
          outcome: 'interrupted',
          reason: event.data.reason
        })
      )
    case 'session.retry.scheduled':
      return apply(
        VltraEvent.RetryScheduled({
          sessionID: event.data.sessionID,
          retry: {
            attempt: event.data.attempt,
            at: event.data.at,
            message: event.data.error.message
          },
          at: event.created
        })
      )
    case 'session.step.started':
    case 'session.reasoning.started':
      return apply(
        VltraEvent.ActivityChanged({
          sessionID: event.data.sessionID,
          activity: { kind: 'thinking' },
          callID: undefined,
          at: event.created
        })
      )
    case 'session.text.started':
      return apply(
        VltraEvent.ActivityChanged({
          sessionID: event.data.sessionID,
          activity: { kind: 'writing' },
          callID: undefined,
          at: event.created
        })
      )
    case 'session.tool.input.started':
      return apply(
        VltraEvent.ActivityChanged({
          sessionID: event.data.sessionID,
          activity: { kind: 'tool', tool: event.data.name },
          callID: event.data.id,
          at: event.created
        })
      )
    case 'session.tool.called':
      return apply(
        VltraEvent.ToolCalled({
          sessionID: event.data.sessionID,
          callID: event.data.id,
          detail: toolDetail(event.data.input),
          at: event.created
        })
      )
    case 'session.status':
      return apply(
        VltraEvent.StatusChanged({
          sessionID: event.data.sessionID,
          status: event.data.status.type,
          at: event.created
        })
      )
    case 'session.viewed':
      return apply(VltraEvent.Viewed({ sessionID: event.data.sessionID, idle: event.data.idle }))
    case 'session.metadata.updated':
      // The event carries the whole (replaced) metadata object.
      return apply(
        VltraEvent.HandledChanged({
          sessionID: event.data.sessionID,
          handled: vltraHandled(event.data.metadata)
        })
      )
    case 'permission.asked':
      return apply(
        VltraEvent.PermissionAsked({
          permission: {
            id: event.data.id,
            sessionID: event.data.sessionID,
            action: event.data.action,
            resources: event.data.resources,
            message: event.data.message
          }
        })
      )
    case 'permission.replied':
      return apply(VltraEvent.PermissionReplied({ requestID: event.data.requestID }))
    case 'form.created':
      return apply(VltraEvent.FormCreated({ form: toPendingForm(event.data.form) }))
    case 'form.replied':
    case 'form.cancelled':
      return apply(VltraEvent.FormSettled({ formID: event.data.id }))
    case 'project.updated':
      return apply(
        VltraEvent.ProjectUpserted({
          project: { id: event.data.id, name: event.data.name, directory: event.data.canonical }
        })
      )
    case 'worktree.updated':
      return [OpenCodeSignal.RefreshWorktrees({ projectID: event.data.projectID })]
    case 'worktree.resolved':
      // A resolution that changes project identity can adopt existing sessions into another
      // project (schema `Worktree.adopt`); events do not list them, so reload everything.
      return event.data.previous !== event.data.projectID || (event.data.adopted ?? []).length > 0
        ? [OpenCodeSignal.Resync()]
        : [OpenCodeSignal.RefreshWorktrees({ projectID: event.data.projectID })]
    default:
      return []
  }
}
