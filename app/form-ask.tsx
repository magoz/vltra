'use client'

import { Predicate } from 'effect'
import { useId, useState, useTransition } from 'react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { answerFor, initialAnswers, isActive, missingRequired } from '@/app/form-answer'
import type { AnswerableField, FormAnswers, FormValue } from '@/app/form-answer'
import { useFleetActions } from '@/app/fleet-actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { FormField, FormOption, PendingForm } from '@/lib/data/fleet/types'

/** A radio or checkbox drawn as a chip, `(•) PDF` style; the native input stays accessible. */
function Choice({
  type,
  name,
  label,
  description,
  checked,
  disabled,
  onChange
}: {
  readonly type: 'radio' | 'checkbox'
  readonly name: string
  readonly label: string
  readonly description: string | undefined
  readonly checked: boolean
  readonly disabled: boolean
  readonly onChange: (checked: boolean) => void
}) {
  const mark = type === 'radio' ? (checked ? '(•)' : '( )') : checked ? '[x]' : '[ ]'

  return (
    <label
      title={description}
      className="border-border has-checked:border-foreground has-focus-visible:ring-ring/50 inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm has-checked:font-semibold has-focus-visible:ring-[3px] has-disabled:cursor-default has-disabled:opacity-50 md:h-7 md:px-2.5 md:text-xs"
    >
      <input
        type={type}
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={event => onChange(event.currentTarget.checked)}
        className="sr-only"
      />
      <span aria-hidden="true" className="text-muted-foreground">
        {mark}
      </span>
      {label}
    </label>
  )
}

const optionLabel = (option: FormOption) => option.label

type FieldProps = {
  readonly field: AnswerableField
  readonly value: FormValue | undefined
  readonly disabled: boolean
  readonly onChange: (value: FormValue | undefined) => void
  /** The question line already shows this field's title: keep its label for assistive tech only. */
  readonly labelled: boolean
  /** Rendered after the choices or input (the Answer button of a one-field form). */
  readonly trailing: ReactNode
}

function FieldTitle({ field, labelled }: Pick<FieldProps, 'field' | 'labelled'>) {
  return (
    <>
      {field.title ?? field.key}
      {field.required === true ? null : <span className="text-muted-foreground"> (optional)</span>}
      {field.description === undefined || labelled ? null : (
        <span className="text-muted-foreground block text-xs">{field.description}</span>
      )}
    </>
  )
}

function Choices({
  legend,
  labelled,
  children
}: {
  readonly legend: ReactNode
  readonly labelled: boolean
  readonly children: ReactNode
}) {
  return (
    <fieldset>
      <legend className={labelled ? 'sr-only' : 'mb-1.5'}>{legend}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  )
}

function FieldInput({ field, value, disabled, onChange, labelled, trailing }: FieldProps) {
  const id = useId()
  const legend = <FieldTitle field={field} labelled={labelled} />

  const label = (
    <label htmlFor={id} className={labelled ? 'sr-only' : 'mb-1.5 block'}>
      {legend}
    </label>
  )

  switch (field.type) {
    case 'string': {
      if (field.options === undefined || field.options.length === 0) {
        return (
          <div>
            {label}
            <div className="flex gap-2">
              <Input
                id={id}
                disabled={disabled}
                placeholder={field.placeholder}
                value={Predicate.isString(value) ? value : ''}
                onChange={event => onChange(event.currentTarget.value)}
              />
              {trailing}
            </div>
          </div>
        )
      }

      const known = field.options.some(option => option.value === value)

      return (
        <div className="space-y-2">
          <Choices legend={legend} labelled={labelled}>
            {field.options.map(option => (
              <Choice
                key={option.value}
                type="radio"
                name={id}
                label={optionLabel(option)}
                description={option.description}
                checked={value === option.value}
                disabled={disabled}
                onChange={() => onChange(option.value)}
              />
            ))}
            {trailing}
          </Choices>
          {field.custom === true ? (
            <Input
              aria-label={`${field.title ?? field.key}: other answer`}
              placeholder="Other…"
              disabled={disabled}
              value={known || !Predicate.isString(value) ? '' : value}
              onChange={event => onChange(event.currentTarget.value)}
            />
          ) : null}
        </div>
      )
    }

    case 'number':
    case 'integer':
      return (
        <div>
          {label}
          <div className="flex gap-2">
            <Input
              id={id}
              type="number"
              inputMode={field.type === 'integer' ? 'numeric' : 'decimal'}
              step={field.type === 'integer' ? 1 : 'any'}
              min={field.minimum}
              max={field.maximum}
              disabled={disabled}
              value={Predicate.isNumber(value) ? value : ''}
              onChange={event => {
                const next = event.currentTarget.valueAsNumber

                onChange(Number.isFinite(next) ? next : undefined)
              }}
            />
            {trailing}
          </div>
        </div>
      )
    case 'boolean':
      return (
        <Choices legend={legend} labelled={labelled}>
          <Choice
            type="radio"
            name={id}
            label="Yes"
            description={undefined}
            checked={value === true}
            disabled={disabled}
            onChange={() => onChange(true)}
          />
          <Choice
            type="radio"
            name={id}
            label="No"
            description={undefined}
            checked={value === false}
            disabled={disabled}
            onChange={() => onChange(false)}
          />
          {trailing}
        </Choices>
      )
    case 'multiselect': {
      const selected: ReadonlyArray<string> = Array.isArray(value) ? value : []

      return (
        <Choices legend={legend} labelled={labelled}>
          {field.options.map(option => (
            <Choice
              key={option.value}
              type="checkbox"
              name={id}
              label={optionLabel(option)}
              description={option.description}
              checked={selected.includes(option.value)}
              disabled={disabled}
              onChange={checked =>
                onChange(
                  checked
                    ? [...selected, option.value]
                    : selected.filter(item => item !== option.value)
                )
              }
            />
          ))}
          {trailing}
        </Choices>
      )
    }
  }
}

function ExternalLink({ field }: { readonly field: Extract<FormField, { type: 'external' }> }) {
  return (
    <p>
      {field.title ?? field.key}:{' '}
      <a href={field.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
        open link
      </a>
      {field.description === undefined ? null : (
        <span className="text-muted-foreground block text-xs">{field.description}</span>
      )}
    </p>
  )
}

/**
 * A pending form (agent question), answered inline: its fields, then Answer. A one-field form
 * reads as one question: the field's title, its choices, and Answer on one line.
 */
export function FormAsk({
  form,
  subagent
}: {
  readonly form: PendingForm
  readonly subagent?: string | undefined
}) {
  const actions = useFleetActions()
  const [answers, setAnswers] = useState<FormAnswers>(() => initialAnswers(form.fields))
  const [pending, startTransition] = useTransition()
  const [sent, setSent] = useState(false)
  const missing = missingRequired(form.fields, answers)
  const [only] = form.fields
  const single = form.fields.length === 1 && only !== undefined && only.type !== 'external'
  const question = single && only.title !== undefined ? only.title : form.title

  const setAnswer = (key: string, value: FormValue | undefined) =>
    setAnswers(current => {
      const { [key]: _previous, ...rest } = current

      return value === undefined ? rest : { ...rest, [key]: value }
    })

  const submit = () =>
    startTransition(async () => {
      const result = await actions.replyForm({
        sessionID: form.sessionID,
        formID: form.id,
        answer: answerFor(form.fields, answers)
      })

      if (Predicate.isTagged(result, 'Error')) {
        toast.error(`Could not answer: ${result.message}`)

        return
      }

      setSent(true)
    })

  const submitButton = sent ? (
    <p className="text-muted-foreground self-center" role="status">
      Answered
    </p>
  ) : (
    <Button type="submit" disabled={pending || missing.length > 0}>
      Answer
    </Button>
  )

  return (
    <form
      className="space-y-3"
      data-slot="form-ask"
      onSubmit={event => {
        event.preventDefault()
        submit()
      }}
    >
      <p className="break-words">
        <span className="text-muted-foreground mr-2 text-xs tracking-wider uppercase">
          Question
        </span>
        {subagent === undefined ? null : (
          <span className="text-muted-foreground">{subagent} · </span>
        )}
        {question}
      </p>
      {form.fields
        .filter(field => isActive(field, answers))
        .map(field =>
          field.type === 'external' ? (
            <ExternalLink key={field.key} field={field} />
          ) : (
            <FieldInput
              key={field.key}
              field={field}
              value={answers[field.key]}
              disabled={pending || sent}
              onChange={value => setAnswer(field.key, value)}
              labelled={single && question === field.title}
              trailing={single ? submitButton : null}
            />
          )
        )}
      {single ? null : submitButton}
    </form>
  )
}
