import { DateTime, Predicate } from 'effect'
import type {
  Form,
  Model,
  OpenCodeEvent,
  Permission,
  Project,
  Session
} from '@opencode/client/effect'
import { FleetEvent, OpenCodeSignal } from '@/lib/data/fleet/events'
import type {
  FormField,
  PendingForm,
  PendingPermission,
  ProjectRecord,
  SessionRecord
} from '@/lib/data/fleet/types'

// OpenCode (v2.0.20 schema) → Fleet domain types. Everything OpenCode-shaped stops here.

const millis = (value: DateTime.Utc | undefined) =>
  value === undefined ? undefined : DateTime.toEpochMillis(value)

export const modelLabel = (model: Model.Ref): string => `${model.providerID}/${model.id}`

export const toSessionRecord = (info: Session.Info): SessionRecord => ({
  id: info.id,
  parentID: info.parentID,
  projectID: info.projectID,
  directory: info.location.directory,
  title: info.title,
  agent: info.agent,
  model: info.model === undefined ? undefined : modelLabel(info.model),
  cost: info.cost,
  created: DateTime.toEpochMillis(info.time.created),
  updated: DateTime.toEpochMillis(info.time.updated),
  idle: millis(info.time.idle),
  viewed: millis(info.time.viewed),
  archived: millis(info.time.archived),
  outcome: info.outcome
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
  // Hidden fields take their default unless answered; Fleet does not ask for them.
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

const apply = (event: FleetEvent): ReadonlyArray<OpenCodeSignal> => [
  OpenCodeSignal.Apply({ event })
]

/**
 * Narrows one OpenCode event to the Fleet signals it implies. Events Fleet does not track
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
      return apply(FleetEvent.SessionRemoved({ sessionID: event.data.sessionID }))
    case 'session.renamed':
      return apply(
        FleetEvent.SessionRenamed({ sessionID: event.data.sessionID, title: event.data.title })
      )
    case 'session.agent.selected':
      return apply(
        FleetEvent.AgentSelected({ sessionID: event.data.sessionID, agent: event.data.agent })
      )
    case 'session.model.selected':
      return apply(
        FleetEvent.ModelSelected({
          sessionID: event.data.sessionID,
          model: modelLabel(event.data.model)
        })
      )
    case 'session.usage.updated':
      return apply(
        FleetEvent.UsageUpdated({ sessionID: event.data.sessionID, cost: event.data.cost })
      )
    case 'session.execution.started':
      return apply(
        FleetEvent.ExecutionStarted({ sessionID: event.data.sessionID, at: event.created })
      )
    case 'session.execution.succeeded':
      return apply(
        FleetEvent.ExecutionEnded({
          sessionID: event.data.sessionID,
          at: event.created,
          outcome: 'succeeded',
          shutdown: false
        })
      )
    case 'session.execution.failed':
      return apply(
        FleetEvent.ExecutionEnded({
          sessionID: event.data.sessionID,
          at: event.created,
          outcome: 'failed',
          shutdown: false
        })
      )
    case 'session.execution.interrupted':
      return apply(
        FleetEvent.ExecutionEnded({
          sessionID: event.data.sessionID,
          at: event.created,
          outcome: 'interrupted',
          shutdown: event.data.reason === 'shutdown'
        })
      )
    case 'session.step.failed':
      return apply(FleetEvent.StepFailed({ sessionID: event.data.sessionID }))
    case 'session.retry.scheduled':
      return apply(
        FleetEvent.RetryScheduled({
          sessionID: event.data.sessionID,
          retry: {
            attempt: event.data.attempt,
            at: event.data.at,
            message: event.data.error.message
          }
        })
      )
    case 'session.step.started':
    case 'session.reasoning.started':
      return apply(
        FleetEvent.ActivityChanged({
          sessionID: event.data.sessionID,
          activity: { kind: 'thinking' },
          callID: undefined
        })
      )
    case 'session.text.started':
      return apply(
        FleetEvent.ActivityChanged({
          sessionID: event.data.sessionID,
          activity: { kind: 'writing' },
          callID: undefined
        })
      )
    case 'session.tool.input.started':
      return apply(
        FleetEvent.ActivityChanged({
          sessionID: event.data.sessionID,
          activity: { kind: 'tool', tool: event.data.name },
          callID: event.data.id
        })
      )
    case 'session.tool.called':
      return apply(
        FleetEvent.ToolCalled({
          sessionID: event.data.sessionID,
          callID: event.data.id,
          detail: toolDetail(event.data.input)
        })
      )
    case 'session.status':
      return apply(
        FleetEvent.StatusChanged({
          sessionID: event.data.sessionID,
          status: event.data.status.type
        })
      )
    case 'session.viewed':
      return apply(FleetEvent.Viewed({ sessionID: event.data.sessionID, idle: event.data.idle }))
    case 'permission.asked':
      return apply(
        FleetEvent.PermissionAsked({
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
      return apply(FleetEvent.PermissionReplied({ requestID: event.data.requestID }))
    case 'form.created':
      return apply(FleetEvent.FormCreated({ form: toPendingForm(event.data.form) }))
    case 'form.replied':
    case 'form.cancelled':
      return apply(FleetEvent.FormSettled({ formID: event.data.id }))
    case 'project.updated':
      return apply(
        FleetEvent.ProjectUpserted({
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
