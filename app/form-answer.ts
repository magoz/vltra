import type { FormCondition, FormField } from '@/lib/data/fleet/types'

// Pure helpers for answering a pending form (agent question) inline. OpenCode validates the final
// answer; these only decide what to show and when "Answer" is enabled.

export type FormValue = string | number | boolean | ReadonlyArray<string>

export type FormAnswers = Readonly<Record<string, FormValue>>

export type AnswerableField = Exclude<FormField, { readonly type: 'external' }>

export const isAnswerable = (field: FormField): field is AnswerableField =>
  field.type !== 'external'

/** Field defaults, as OpenCode would apply them. */
export const initialAnswers = (fields: ReadonlyArray<FormField>): FormAnswers =>
  Object.fromEntries(
    fields.flatMap(field =>
      isAnswerable(field) && field.default !== undefined ? [[field.key, field.default]] : []
    )
  )

const holds = (condition: FormCondition, answers: FormAnswers) => {
  const answer = answers[condition.key]

  if (answer === undefined) return false

  const matches = Array.isArray(answer)
    ? answer.includes(String(condition.value))
    : answer === condition.value

  return condition.op === 'eq' ? matches : !matches
}

/** A field is active while all of its `when` conditions hold. */
export const isActive = (field: FormField, answers: FormAnswers) =>
  field.type === 'external' || (field.when ?? []).every(condition => holds(condition, answers))

const isAnswered = (value: FormValue | undefined) =>
  value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0)

/** Required, active fields that still have no answer. */
export const missingRequired = (fields: ReadonlyArray<FormField>, answers: FormAnswers) =>
  fields.filter(
    field =>
      isAnswerable(field) &&
      field.required === true &&
      isActive(field, answers) &&
      !isAnswered(answers[field.key])
  )

/** The answer to send: only answered, active fields. */
export const answerFor = (fields: ReadonlyArray<FormField>, answers: FormAnswers): FormAnswers =>
  Object.fromEntries(
    fields.flatMap(field => {
      const value = answers[field.key]

      if (value === undefined) return []

      return isAnswerable(field) && isActive(field, answers) && isAnswered(value)
        ? [[field.key, value] as const]
        : []
    })
  )
