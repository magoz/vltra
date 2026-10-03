import { Option, Schema } from 'effect'

// Branch names for the launcher (DESIGN.md "Launcher and worktrees"): validation, the exact
// `name` encoding the dotfiles `worktrees` plugin decodes, the model's suggestion check, and the
// deterministic fallback slug. Pure.

/** A git ref segment Fleet accepts: `[A-Za-z0-9._-]`, starting with a letter or digit. */
const segmentPattern = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9_])?$/

/** OpenCode's worktree `name` (the plugin's contract): one path segment, at most 120 chars. */
const namePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/

const isSegment = (segment: string) =>
  segmentPattern.test(segment) &&
  !segment.includes('--') &&
  !segment.includes('..') &&
  !segment.endsWith('.lock')

/**
 * The worktree `name` for `branch`: `branch.replaceAll('/', '--')`, when that decodes back to
 * exactly `branch` (the plugin's rule 1). None for branches with no exact encoding: no `/`, an
 * empty segment, a segment containing `--` or starting/ending with `-`, or anything git would
 * refuse.
 */
export const branchToName = (branch: string): Option.Option<string> => {
  const segments = branch.split('/')

  if (segments.length < 2 || !segments.every(isSegment)) return Option.none()

  const name = segments.join('--')

  return namePattern.test(name) ? Option.some(name) : Option.none()
}

/** The branch a worktree `name` stands for (`--` separates segments); the inverse above. */
export const nameToBranch = (name: string): string => name.replaceAll('--', '/')

/** A branch the launcher can create: it encodes exactly as a worktree `name`. */
export const Branch = Schema.String.check(
  Schema.makeFilter((branch: string) => Option.isSome(branchToName(branch)), {
    message: 'Branch must look like type/short-name (letters, digits, . _ -, no --)'
  })
)

/** Conventional branch prefixes the suggestion may use (Pi's `/worktree` rules). */
export const branchTypes = ['feat', 'fix', 'chore', 'docs', 'refactor', 'test'] as const

/** Longest suggestion accepted from the model ("about 40" characters asked for). */
export const suggestionLimit = 48

const suggestionPattern = new RegExp(`^(?:${branchTypes.join('|')})/[a-z0-9]+(?:-[a-z0-9]+)*$`)

/**
 * The model's answer as a branch, when it is exactly one conventional branch name: a type prefix
 * and a short kebab-case slug, nothing else (surrounding quotes, backticks and whitespace are
 * tolerated). None for anything else, so the caller falls back.
 */
export const parseSuggestion = (text: string): Option.Option<string> => {
  const lines = text
    .trim()
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '')

  if (lines.length !== 1) return Option.none()

  const candidate = (lines[0] ?? '').replace(/^[`'"]+|[`'"]+$/g, '').trim()

  return candidate.length <= suggestionLimit &&
    suggestionPattern.test(candidate) &&
    Option.isSome(branchToName(candidate))
    ? Option.some(candidate)
    : Option.none()
}

/** Longest fallback slug, prefix included. */
export const fallbackLimit = 40

/**
 * The deterministic fallback: `feat/` and the kebab case of the task's first words (ASCII,
 * lower case), as many as fit in `fallbackLimit`; `feat/task` when no word is usable.
 */
export const fallbackBranch = (task: string): string => {
  const words = task
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(word => word !== '')

  const prefix = 'feat/'
  let slug = ''

  for (const word of words) {
    const next = slug === '' ? word : `${slug}-${word}`

    if (prefix.length + next.length > fallbackLimit) {
      if (slug === '') slug = word.slice(0, fallbackLimit - prefix.length)

      break
    }

    slug = next
  }

  return `${prefix}${slug === '' ? 'task' : slug}`
}

/** Longest task text sent to the model. */
const taskLimit = 2000

/** The `generate.text` prompt for one branch name (Pi's `/worktree` naming rules). */
export const suggestionPrompt = (task: string): string =>
  [
    'Name a git branch for the task below. Reply with the branch name only: no quotes, no explanation.',
    'Rules:',
    `- Start with exactly one of ${branchTypes.map(type => `${type}/`).join(' ')} (the one that fits).`,
    '- Then a short kebab-case slug: 2 to 5 lowercase words (a-z, 0-9) joined by hyphens.',
    '- At most 40 characters in total.',
    '- No ticket or issue numbers unless the task gives one.',
    '',
    'Task:',
    task.trim().slice(0, taskLimit)
  ].join('\n')
