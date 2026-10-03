'use client'

import { Predicate } from 'effect'
import { useEffect, useId, useState, useTransition } from 'react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import {
  activityText,
  formatCost,
  modelName,
  plural,
  relativeTime,
  sessionTitle
} from '@/app/fleet-format'
import { useFleetActions } from '@/app/fleet-actions'
import { HandledButton, ReopenButton } from '@/app/handled-button'
import { PendingAsks } from '@/app/pending-asks'
import { StateMarker } from '@/app/state-marker'
import { useSessionDetail } from '@/app/use-session-detail'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import { Button, buttonVariants } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { BoardRow } from '@/lib/data/fleet/board'
import type {
  FileChange,
  FleetChildRow,
  SessionDetail,
  TranscriptEntry
} from '@/lib/data/fleet/types'
import { cn } from '@/lib/utils'

function PanelSection({
  title,
  children
}: {
  readonly title: ReactNode
  readonly children: ReactNode
}) {
  return (
    <section className="mt-5">
      <h3 className="text-muted-foreground mb-2 text-xs tracking-widest uppercase">{title}</h3>
      {children}
    </section>
  )
}

const roleNames: Readonly<Record<TranscriptEntry['role'], string>> = {
  user: 'you',
  agent: 'agent',
  tool: 'tool',
  shell: 'shell',
  error: 'error',
  note: 'note'
}

function Transcript({ entries }: { readonly entries: ReadonlyArray<TranscriptEntry> }) {
  if (entries.length === 0) {
    return <p className="text-muted-foreground">No messages yet.</p>
  }

  return (
    <ol className="border-border space-y-2 border-l pl-3">
      {entries.map(entry => (
        <li
          key={entry.id}
          data-role={entry.role}
          className={cn(
            'break-words whitespace-pre-wrap',
            (entry.role === 'tool' || entry.role === 'shell' || entry.role === 'note') &&
              'text-muted-foreground',
            entry.role === 'error' && 'text-destructive',
            entry.status === 'running' && 'text-foreground'
          )}
        >
          <span className="text-muted-foreground mr-2 text-xs">{roleNames[entry.role]}</span>
          {entry.text}
          {entry.status === 'error' ? <span className="text-destructive"> · failed</span> : null}
          {entry.status === 'running' ? (
            <span className="text-muted-foreground"> · running</span>
          ) : null}
        </li>
      ))}
    </ol>
  )
}

const totals = (files: ReadonlyArray<FileChange>) => ({
  additions: files.reduce((sum, file) => sum + file.additions, 0),
  deletions: files.reduce((sum, file) => sum + file.deletions, 0)
})

function Files({ files }: { readonly files: ReadonlyArray<FileChange> }) {
  const sum = totals(files)

  return (
    <PanelSection
      title={
        <>
          Files changed · {files.length} · <span className="text-attention">+{sum.additions}</span>{' '}
          <span className="text-destructive">−{sum.deletions}</span>
        </>
      }
    >
      <ul>
        {files.map(file => (
          <li
            key={file.file}
            className="border-hairline flex justify-between gap-4 border-b py-1 last:border-b-0"
          >
            <span className="min-w-0 break-all">{file.file}</span>
            <span className="shrink-0 whitespace-nowrap">
              {file.additions > 0 ? (
                <span className="text-attention">+{file.additions}</span>
              ) : null}
              {file.additions > 0 && file.deletions > 0 ? ' ' : null}
              {file.deletions > 0 ? (
                <span className="text-destructive">−{file.deletions}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </PanelSection>
  )
}

function DetailBody({
  sessionID,
  version
}: {
  readonly sessionID: string
  readonly version: string
}) {
  const state = useSessionDetail(sessionID, version)

  switch (state.status) {
    case 'loading':
      return (
        <PanelSection title="Last messages">
          <p className="text-muted-foreground" aria-busy="true">
            Loading messages…
          </p>
        </PanelSection>
      )
    case 'error':
      return (
        <PanelSection title="Last messages">
          <p className="text-destructive" role="alert">
            {state.message}
          </p>
        </PanelSection>
      )
    case 'ready':
      return <DetailContent detail={state.detail} />
  }
}

function DetailContent({ detail }: { readonly detail: SessionDetail }) {
  return (
    <>
      <PanelSection title="Last messages">
        <Transcript entries={detail.transcript.entries} />
      </PanelSection>
      {detail.files === undefined || detail.files.length === 0 ? null : (
        <Files files={detail.files} />
      )}
    </>
  )
}

function PromptBox({ sessionID }: { readonly sessionID: string }) {
  const actions = useFleetActions()
  const id = useId()
  const [text, setText] = useState('')
  const [pending, startTransition] = useTransition()

  const send = () =>
    startTransition(async () => {
      const result = await actions.sendPrompt({ sessionID, text })

      if (Predicate.isTagged(result, 'Error')) {
        toast.error(`Could not send: ${result.message}`)

        return
      }

      setText('')
      toast.success('Sent')
    })

  return (
    <PanelSection title={<label htmlFor={id}>Follow up</label>}>
      <form
        className="space-y-2"
        onSubmit={event => {
          event.preventDefault()
          send()
        }}
      >
        <Textarea
          id={id}
          value={text}
          disabled={pending}
          placeholder="Ask the agent to continue, or steer it…"
          onChange={event => setText(event.currentTarget.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()

              if (text.trim() !== '') send()
            }
          }}
        />
        <Button type="submit" disabled={pending || text.trim() === ''}>
          Send
        </Button>
      </form>
    </PanelSection>
  )
}

function InterruptButton({
  sessionID,
  title
}: {
  readonly sessionID: string
  readonly title: string
}) {
  const actions = useFleetActions()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const interrupt = () =>
    startTransition(async () => {
      const result = await actions.interrupt({ sessionID })

      if (Predicate.isTagged(result, 'Error')) {
        toast.error(`Could not interrupt: ${result.message}`)

        return
      }

      setOpen(false)
      toast.success('Interrupted')
    })

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="destructive" />}>Interrupt</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Interrupt “{title}”?</AlertDialogTitle>
          <AlertDialogDescription>
            The current run stops. You can send a follow-up to continue it later.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep running</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={pending} onClick={interrupt}>
            Interrupt
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function CopyCommand({ command }: { readonly command: string }) {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    navigator.clipboard
      .writeText(command)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => toast.error('Could not copy; select the command instead'))
  }

  return (
    <div className="border-hairline flex items-center justify-between gap-2 rounded-md border py-1 pr-1 pl-3">
      <code className="min-w-0 truncate select-all">{command}</code>
      <Button variant="outline" size="sm" onClick={copy}>
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}

function WaysOut({ row }: { readonly row: BoardRow['row'] }) {
  return (
    <PanelSection title="Open elsewhere">
      <div className="flex flex-wrap gap-2">
        <a
          href={row.links.web}
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ variant: 'outline' })}
        >
          Open in OpenCode
        </a>
        {/* `ocb://` is handled by the Mac URL-scheme app only; touch devices cannot open it. */}
        <a
          href={row.links.terminal}
          className={cn(buttonVariants({ variant: 'outline' }), 'pointer-coarse:hidden')}
        >
          Open in terminal
        </a>
      </div>
      <div className="mt-2">
        <CopyCommand command={row.links.command} />
      </div>
    </PanelSection>
  )
}

/** A subagent's own state, in words: blocked, its live activity, done, failed, not started. */
const childStatus = (child: FleetChildRow): string => {
  switch (child.ownState) {
    case 'blocked':
      return 'blocked'
    case 'working':
      return child.activity === undefined ? 'working' : activityText(child.activity)
    case 'finished':
    case 'handled':
      if (child.idle === undefined) return 'not started'

      return child.outcome === 'failed' ? 'failed' : 'done'
  }
}

/** The subagent tree, depth-first, each child with its own state. */
function Subagents({ row }: { readonly row: BoardRow['row'] }) {
  return (
    <PanelSection title={plural(row.children.length, 'subagent', 'subagents')}>
      <ul className="space-y-1" aria-label="Subagents">
        {row.children.map(child => (
          <li
            key={child.id}
            data-state={child.ownState}
            className="flex items-baseline gap-2"
            style={{ paddingLeft: `${(child.depth - 1) * 0.75}rem` }}
          >
            <StateMarker
              state={child.ownState}
              failed={child.outcome === 'failed'}
              className="translate-y-px"
            />
            <span className="min-w-0 break-words">
              {child.agent === undefined ? null : (
                <span className="text-muted-foreground">{child.agent} · </span>
              )}
              {sessionTitle(child)}
              <span
                className={cn(
                  'text-muted-foreground',
                  child.outcome === 'failed' && child.ownState !== 'working' && 'text-destructive'
                )}
              >
                {' '}
                · {childStatus(child)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </PanelSection>
  )
}

/**
 * Opening a session's panel marks its latest run viewed in OpenCode (its own unread dots). Fleet
 * state never depends on it.
 */
function useMarkViewed(sessionID: string, row: BoardRow['row'] | undefined) {
  const actions = useFleetActions()
  const idle = row?.idle
  const unread = idle !== undefined && (row?.viewed === undefined || row.viewed < idle)

  useEffect(() => {
    if (!unread) return

    actions.markViewed({ sessionID }).catch(() => {
      // Only OpenCode's unread dots depend on it; the next open tries again.
    })
  }, [actions, sessionID, idle, unread])
}

/**
 * The session panel: side panel on desktop, full screen on the phone. Header facts, inline
 * answers, recent messages and files, the subagent tree, Handled (finished) / Reopen (handled),
 * follow-up prompt, Interrupt (while running), and the ways out.
 */
export function SessionPanel({
  sessionID,
  item,
  now,
  onClose
}: {
  readonly sessionID: string
  /** The row, when the session is on the board. */
  readonly item: BoardRow | undefined
  readonly now: number
  readonly onClose: () => void
}) {
  const row = item?.row
  const title = row === undefined ? sessionID : sessionTitle(row)
  const cost = row === undefined ? undefined : formatCost(row.cost)
  const model = modelName(row?.model)

  useMarkViewed(sessionID, row)

  const facts = [
    item?.project,
    item?.worktree,
    model,
    row === undefined ? undefined : relativeTime(row.activeAt, now),
    cost
  ].filter(Predicate.isNotUndefined)

  const version =
    row === undefined
      ? 'unknown'
      : `${row.state}:${row.activeAt}:${row.idle ?? 0}:${JSON.stringify(row.activity ?? null)}`

  const interrupt =
    row?.running === true ? <InterruptButton sessionID={sessionID} title={title} /> : null

  return (
    <div className="flex min-h-full flex-col" aria-labelledby="session-panel-title">
      <div className="bg-background/95 sticky top-0 z-10 flex items-center justify-between gap-2 border-b px-2 py-2 lg:hidden">
        <Button variant="ghost" onClick={onClose}>
          ‹ Fleet
        </Button>
        {interrupt}
      </div>
      <div className="px-4 pt-4 pb-10">
        <div className="flex items-start justify-between gap-3">
          <h2 id="session-panel-title" className="flex min-w-0 items-baseline gap-2 font-semibold">
            {row === undefined ? null : (
              <StateMarker
                state={row.state}
                failed={row.outcome === 'failed'}
                className="shrink-0 translate-y-px"
              />
            )}
            <span className="min-w-0 break-words">{title}</span>
          </h2>
          <div className="flex shrink-0 items-center gap-2 max-lg:hidden">
            {interrupt}
            <Button variant="ghost" size="icon-sm" aria-label="Close panel" onClick={onClose}>
              ×
            </Button>
          </div>
        </div>
        {facts.length === 0 ? null : (
          <p className="text-muted-foreground mt-1 text-xs">{facts.join(' · ')}</p>
        )}
        {row === undefined ? (
          <p className="text-muted-foreground mt-3">
            This session is not on the board (it may be archived or a subagent).
          </p>
        ) : null}
        {row !== undefined && row.state === 'blocked' ? (
          <PanelSection title="Needs you">
            <PendingAsks row={row} />
          </PanelSection>
        ) : null}
        <DetailBody sessionID={sessionID} version={version} />
        {row !== undefined && row.children.length > 0 ? <Subagents row={row} /> : null}
        {row !== undefined && row.state === 'finished' ? (
          <div className="mt-5">
            <HandledButton sessionID={sessionID} variant="default" />
          </div>
        ) : null}
        {row !== undefined && row.state === 'handled' && row.handled !== undefined ? (
          <div className="mt-5">
            <ReopenButton sessionID={sessionID} />
          </div>
        ) : null}
        <PromptBox sessionID={sessionID} />
        {row === undefined ? null : <WaysOut row={row} />}
      </div>
    </div>
  )
}
