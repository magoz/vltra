import { Fragment } from 'react'
import type { PullRequest, WorktreeOwner } from '@/lib/data/vltra/types'
import { cn } from '@/lib/utils'

// A worktree's owner and PR state, as the launcher palette and the Projects cards show them.

/**
 * Pi/Herdr worktrees (no dotfiles marker, on a branch) get a muted `pi`, detached checkouts
 * (OpenCode's own git strategy) a muted `detached`; Vltra/OpenCode (dotfiles) ones nothing.
 */
export function OwnerBadge({
  owner,
  branch
}: {
  readonly owner: WorktreeOwner
  readonly branch: string | undefined
}) {
  if (owner === 'dotfiles') return null

  return branch === undefined ? (
    <span className="text-muted-foreground" title="Detached checkout, not managed by Vltra">
      detached
    </span>
  ) : (
    <span className="text-muted-foreground" title="Pi/Herdr worktree (retire it through Herdr)">
      pi
    </span>
  )
}

const prText = (pr: PullRequest): string | undefined => {
  switch (pr.state) {
    case 'open':
      return pr.number === undefined ? 'PR open' : `#${pr.number} open`
    case 'merged':
      return 'merged · retire'
    case 'closed':
      return 'closed · retire'
    case 'none':
    case 'unknown':
      return undefined
  }
}

/**
 * `#123 open`, `merged · retire` (green: done, time to retire), `closed · retire` (red), then the
 * issues it closes (`· closes #98`); nothing without a PR or while unknown. Links to the PR and
 * the issues when `link` (not inside a clickable row).
 */
export function PrBadge({
  pr,
  link = false,
  className
}: {
  readonly pr: PullRequest
  readonly link?: boolean
  readonly className?: string
}) {
  const text = prText(pr)

  if (text === undefined) return null

  const classes = cn(
    pr.state === 'merged' && 'text-attention',
    pr.state === 'closed' && 'text-destructive',
    pr.state === 'open' && 'text-muted-foreground'
  )

  const title = pr.number === undefined ? undefined : `Pull request #${pr.number} (${pr.state})`
  const issues = pr.issues ?? []

  return (
    <span className={cn('whitespace-nowrap', className)}>
      {link && pr.url !== undefined ? (
        <a
          href={pr.url}
          target="_blank"
          rel="noreferrer"
          title={title}
          className={cn(classes, 'hover:underline')}
        >
          {text}
        </a>
      ) : (
        <span title={title} className={classes}>
          {text}
        </span>
      )}
      {issues.length === 0 ? null : (
        <span className="text-muted-foreground">
          {' · closes '}
          {issues.map((issue, index) => (
            <Fragment key={issue.number}>
              {index === 0 ? null : ', '}
              {link ? (
                <a
                  href={issue.url}
                  target="_blank"
                  rel="noreferrer"
                  title={`Issue #${issue.number}`}
                  className="hover:underline"
                >
                  #{issue.number}
                </a>
              ) : (
                `#${issue.number}`
              )}
            </Fragment>
          ))}
        </span>
      )}
    </span>
  )
}
