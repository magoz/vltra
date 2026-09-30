import { describe, expect, it } from 'vitest'
import { answerFor, initialAnswers, isActive, missingRequired } from '@/app/form-answer'
import type { FormField } from '@/lib/data/fleet/types'

const fields: ReadonlyArray<FormField> = [
  {
    key: 'format',
    type: 'string',
    required: true,
    options: [
      { value: 'pdf', label: 'PDF' },
      { value: 'docx', label: 'DOCX' }
    ]
  },
  {
    key: 'toc',
    type: 'boolean',
    default: true,
    when: [{ key: 'format', op: 'eq', value: 'pdf' }]
  },
  { key: 'tags', type: 'multiselect', options: [{ value: 'a', label: 'A' }] },
  { key: 'docs', type: 'external', url: 'https://example.com' }
]

describe('form answers', () => {
  it('starts from field defaults', () => {
    expect(initialAnswers(fields)).toEqual({ toc: true })
  })

  it('shows conditional fields only while their conditions hold', () => {
    const toc = fields[1]

    if (toc === undefined) throw new Error('missing toc')

    expect(isActive(toc, {})).toBe(false)
    expect(isActive(toc, { format: 'pdf' })).toBe(true)
    expect(isActive(toc, { format: 'docx' })).toBe(false)
  })

  it('waits for required answers', () => {
    expect(missingRequired(fields, {}).map(field => field.key)).toEqual(['format'])
    expect(missingRequired(fields, { format: 'docx' })).toEqual([])
  })

  it('sends only answered, active fields', () => {
    expect(answerFor(fields, { format: 'docx', toc: true, tags: [] })).toEqual({ format: 'docx' })
    expect(answerFor(fields, { format: 'pdf', toc: false, tags: ['a'] })).toEqual({
      format: 'pdf',
      toc: false,
      tags: ['a']
    })
  })
})
