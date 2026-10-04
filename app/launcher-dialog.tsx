'use client'

import { Option, Predicate } from 'effect'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import type { KeyboardEvent } from 'react'
import { toast } from 'sonner'
import { settled, useFleetActions } from '@/app/fleet-actions'
import { useFleet } from '@/app/fleet-context'
import { relativeTime } from '@/app/fleet-format'
import type { LauncherRequest } from '@/app/launcher-context'
import { OwnerBadge, PrBadge } from '@/app/worktree-badges'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { branchToName, fallbackBranch } from '@/lib/data/fleet/branch'
import { paletteItems, worktreeName } from '@/lib/data/fleet/palette'
import type { PaletteItem } from '@/lib/data/fleet/palette'
import type {
  BranchSuggestion,
  LauncherEntry,
  LauncherList,
  SessionTally
} from '@/lib/data/fleet/types'
import { cn } from '@/lib/utils'

/** Quiet time after typing the task before a branch is suggested. */
export const suggestDelay = 600

const isField = (target: EventTarget) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || target.closest('input, textarea, select') !== null)

/** `2 need you · 1 working`, zeros left out (need you in green). */
function Tally({ sessions }: { readonly sessions: SessionTally }) {
  const needMe = sessions.blocked + sessions.finished

  return (
    <>
      {needMe === 0 ? null : (
        <span className="text-attention">
          {needMe} {needMe === 1 ? 'needs you' : 'need you'}
        </span>
      )}
      {sessions.working === 0 ? null : <span>{sessions.working} working</span>}
    </>
  )
}

function Row({
  item,
  now,
  grouped
}: {
  readonly item: PaletteItem
  readonly now: number
  /** Worktrees right under their repository (no filter): no repository prefix. */
  readonly grouped: boolean
}) {
  const at = item.kind === 'repo' ? item.entry.lastActivity : item.worktree.activeAt

  return (
    <>
      {item.kind === 'repo' ? (
        <span className="min-w-0 font-semibold break-all">{item.entry.name}</span>
      ) : (
        <span className="min-w-0 pl-4 break-all">
          <span aria-hidden="true" className="text-muted-foreground">
            └{' '}
          </span>
          {grouped ? null : <span className="text-muted-foreground">{item.entry.name} · </span>}
          {worktreeName(item.worktree)}
        </span>
      )}
      <span className="text-muted-foreground ml-auto flex shrink-0 items-baseline gap-x-2.5 text-xs">
        {item.kind === 'worktree' ? (
          <>
            <OwnerBadge owner={item.worktree.owner} branch={item.worktree.branch} />
            <PrBadge pr={item.worktree.pr} />
          </>
        ) : null}
        <Tally sessions={item.kind === 'repo' ? item.entry.sessions : item.worktree.sessions} />
        {at === undefined ? null : <span>{relativeTime(at, now)}</span>}
      </span>
    </>
  )
}

/** Where a row's new session runs: the repository, or `repo · branch` for a worktree. */
const placeName = (item: PaletteItem) =>
  item.kind === 'repo' ? item.entry.name : `${item.entry.name} · ${worktreeName(item.worktree)}`

const placeDirectory = (item: PaletteItem) =>
  item.kind === 'repo' ? item.entry.directory : item.worktree.directory

/**
 * The palette's bottom bar: the highlighted row's two actions, keys shown on desktop (`↵` a new
 * session there, `⇧↵` a new worktree in its repository), then the list keys. Buttons for pointers
 * (the phone taps a row, then an action); the keyboard uses the keys, so they stay out of the tab
 * order. In one place under the list, so moving the highlight never shifts the rows.
 */
function ActionBar({
  item,
  starting,
  onSession,
  onWorktree
}: {
  readonly item: PaletteItem
  readonly starting: boolean
  readonly onSession: () => void
  readonly onWorktree: () => void
}) {
  const action =
    'hover:text-foreground flex min-w-0 items-baseline gap-2 text-left disabled:opacity-50 max-lg:py-2'

  return (
    <div className="text-muted-foreground flex shrink-0 flex-wrap items-baseline gap-x-5 gap-y-1 border-t px-3 py-1.5 text-xs max-lg:flex-col max-lg:items-stretch">
      <button
        type="button"
        tabIndex={-1}
        aria-keyshortcuts="Enter"
        disabled={starting}
        onClick={onSession}
        className={cn(action, 'text-attention')}
      >
        <kbd aria-hidden="true" className="text-foreground font-mono max-lg:hidden">
          ↵
        </kbd>
        <span className="truncate">
          {starting ? 'Starting…' : `New session in ${placeName(item)}`}
        </span>
      </button>
      <button
        type="button"
        tabIndex={-1}
        aria-keyshortcuts="Shift+Enter"
        disabled={starting}
        onClick={onWorktree}
        className={action}
      >
        <kbd aria-hidden="true" className="text-foreground font-mono max-lg:hidden">
          ⇧↵
        </kbd>
        <span className="truncate">New worktree in {item.entry.name}…</span>
      </button>
      <span className="ml-auto shrink-0 max-lg:hidden">
        <kbd className="text-foreground">↑ ↓</kbd> move · <kbd className="text-foreground">esc</kbd>{' '}
        close
      </span>
    </div>
  )
}

/**
 * The palette's first step: pick a repository or worktree. The bar under the list shows what the
 * highlighted row starts (`ActionBar`): `Enter` a new session there, `Shift+Enter` a new worktree
 * in its repository. A click or tap moves the highlight; hovering does not.
 */
function PickStep({
  list,
  onNew,
  onClose
}: {
  readonly list: LauncherList | undefined
  readonly onNew: (repo: string) => void
  readonly onClose: () => void
}) {
  const actions = useFleetActions()
  const { now, nav } = useFleet()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [starting, setStarting] = useState<string>()
  const [, startTransition] = useTransition()
  const entries = useMemo(() => list?.entries ?? [], [list])
  const items = useMemo(() => paletteItems(entries, query), [entries, query])
  const highlighted = useRef<HTMLLIElement>(null)
  const index = Math.max(0, Math.min(cursor, items.length - 1))
  const current = items[index]

  useEffect(() => {
    highlighted.current?.scrollIntoView?.({ block: 'nearest' })
  }, [index])

  const move = (delta: number) => setCursor(Math.max(0, Math.min(index + delta, items.length - 1)))

  const startSession = (item: PaletteItem) => {
    if (starting !== undefined) return

    setStarting(item.key)

    startTransition(async () => {
      const result = await settled(actions.newSession({ directory: placeDirectory(item) }))

      setStarting(undefined)

      if (Predicate.isTagged(result, 'Error')) {
        toast.error(`Could not start a session: ${result.message}`)

        return
      }

      onClose()
      nav.openSession(result.value.sessionID)
      toast(`New session in ${placeName(item)}`)
    })
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const typing = isField(event.target)

    if (event.key === 'ArrowDown' || (!typing && event.key === 'j')) move(1)
    else if (event.key === 'ArrowUp' || (!typing && event.key === 'k')) move(-1)
    else if (event.key === 'Enter' && current !== undefined) {
      if (event.shiftKey) onNew(current.entry.directory)
      else startSession(current)
    } else return

    event.preventDefault()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
      <DialogTitle className="sr-only">Start a session or a worktree</DialogTitle>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Input
          autoFocus
          value={query}
          onChange={event => {
            setQuery(event.target.value)
            setCursor(0)
          }}
          placeholder="Find a repo or worktree…"
          aria-label="Filter repositories and worktrees"
          aria-controls="launcher-list"
          aria-activedescendant={current === undefined ? undefined : `launcher-row-${index}`}
          className="border-0 px-0 shadow-none focus-visible:ring-0"
        />
        <DialogClose render={<Button variant="ghost" size="sm" className="lg:hidden" />}>
          Close
        </DialogClose>
      </div>
      {list === undefined ? (
        <p className="text-muted-foreground px-3 py-6 text-center text-xs">Loading repositories…</p>
      ) : entries.length === 0 ? (
        <p className="text-muted-foreground px-3 py-6 text-center text-xs">
          No git repositories under the launcher roots.
        </p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground px-3 py-6 text-center text-xs">No matches.</p>
      ) : (
        <ul
          id="launcher-list"
          role="listbox"
          aria-label="Repositories and worktrees"
          tabIndex={0}
          className="min-h-0 flex-1 overflow-y-auto py-1 outline-none"
        >
          {items.map((item, position) => (
            <li
              key={item.key}
              id={`launcher-row-${position}`}
              ref={position === index ? highlighted : undefined}
              role="option"
              aria-selected={position === index}
              data-kind={item.kind}
              onClick={() => setCursor(position)}
              className="aria-selected:bg-accent flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-1.5"
            >
              <Row item={item} now={now} grouped={query.trim() === ''} />
            </li>
          ))}
        </ul>
      )}
      {current === undefined ? null : (
        <ActionBar
          item={current}
          starting={starting === current.key}
          onSession={() => startSession(current)}
          onWorktree={() => onNew(current.entry.directory)}
        />
      )}
    </div>
  )
}

/** The second step: describe the task, take (or edit) the suggested branch, create. */
function NewStep({
  entry,
  onBack,
  onLaunched,
  onClose
}: {
  readonly entry: LauncherEntry
  readonly onBack: () => void
  readonly onLaunched: (launchID: string, branch: string) => void
  readonly onClose: () => void
}) {
  const actions = useFleetActions()
  const [task, setTask] = useState('')
  const [typed, setTyped] = useState<string>()
  const [suggestion, setSuggestion] = useState<BranchSuggestion & { readonly task: string }>()
  const [error, setError] = useState<string>()
  const [pending, startTransition] = useTransition()
  const branch = typed ?? suggestion?.branch ?? ''
  const valid = Option.isSome(branchToName(branch))
  const wanted = task.trim()
  const suggesting = typed === undefined && wanted !== '' && suggestion?.task !== wanted

  // Suggest once typing pauses, unless the branch was edited by hand. Late answers for an older
  // task are dropped.
  useEffect(() => {
    if (typed !== undefined || wanted === '') return

    let current = true

    const timer = setTimeout(() => {
      settled(actions.suggestBranch({ task: wanted }))
        .then(result => {
          if (!current) return

          setSuggestion(
            Predicate.isTagged(result, 'Success')
              ? { ...result.value, task: wanted }
              : { branch: fallbackBranch(wanted), source: 'fallback', task: wanted }
          )
        })
        .catch(() => undefined)
    }, suggestDelay)

    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [actions, typed, wanted])

  const create = () => {
    if (pending || wanted === '' || !valid) return

    setError(undefined)

    startTransition(async () => {
      const result = await settled(
        actions.launch({ repoDir: entry.directory, branch, task: wanted })
      )

      if (Predicate.isTagged(result, 'Error')) {
        setError(result.message)

        return
      }

      onLaunched(result.value.launchID, branch)
      onClose()
    })
  }

  const submitOnModEnter = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      create()
    }
  }

  const hint = suggesting
    ? 'suggesting…'
    : typed === undefined && suggestion !== undefined
      ? suggestion.source === 'model'
        ? 'suggested'
        : 'suggested (from the task)'
      : undefined

  return (
    <form
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3"
      onSubmit={event => {
        event.preventDefault()
        create()
      }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <DialogTitle>New worktree in {entry.name}</DialogTitle>
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          ← Repos
        </Button>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground text-xs">Task</span>
        <Textarea
          autoFocus
          value={task}
          onChange={event => setTask(event.target.value)}
          onKeyDown={submitOnModEnter}
          placeholder="What should the agent do?"
          rows={5}
          aria-label="Task"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground flex items-baseline justify-between text-xs">
          <span>Branch</span>
          {hint === undefined ? null : <span aria-live="polite">{hint}</span>}
        </span>
        <Input
          value={branch}
          onChange={event => setTyped(event.target.value)}
          onKeyDown={submitOnModEnter}
          placeholder="feat/short-name"
          aria-label="Branch"
          aria-invalid={branch !== '' && !valid}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        {branch !== '' && !valid ? (
          <span className="text-destructive text-xs">
            type/short-name: letters, digits, . _ - (no -- or spaces)
          </span>
        ) : null}
      </label>
      {error === undefined ? null : (
        <p role="alert" className="text-destructive text-xs break-words">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground text-xs max-lg:hidden">
          <kbd className="text-foreground">⌘↵</kbd> create
        </span>
        <Button type="submit" disabled={pending || wanted === '' || !valid}>
          {pending ? 'Creating…' : 'Create'}
        </Button>
      </div>
    </form>
  )
}

/**
 * The launcher (DESIGN.md "Launcher and worktrees"): a palette over the repositories on Box and
 * their worktrees, most recent agent activity first. Type to filter, `↑`/`↓` (or `j`/`k` from the
 * list) to move. `Enter` starts a new empty session in the highlighted repository or worktree;
 * `Shift+Enter` a new worktree in its repository: a task, a suggested branch, Create. Full screen
 * on the phone (tap a row, then one of its actions); `Escape` closes.
 */
export function LauncherDialog({
  open,
  request,
  list,
  onOpenChange,
  onLaunched
}: {
  readonly open: boolean
  readonly request: LauncherRequest
  readonly list: LauncherList | undefined
  readonly onOpenChange: (open: boolean) => void
  readonly onLaunched: (launchID: string, branch: string) => void
}) {
  const [step, setStep] = useState<LauncherRequest>(request)
  const [shown, setShown] = useState(request)

  // Every opening starts from its own request.
  if (shown !== request) {
    setShown(request)
    setStep(request)
  }

  const close = () => onOpenChange(false)

  const entry =
    step.step === 'new' ? list?.entries.find(item => item.directory === step.repo) : undefined

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-label="Launcher"
        className="max-lg:inset-0 lg:top-[12vh] lg:left-1/2 lg:max-h-[70vh] lg:w-[40rem] lg:-translate-x-1/2"
      >
        {step.step === 'new' && entry !== undefined ? (
          <NewStep
            entry={entry}
            onBack={() => setStep({ step: 'pick' })}
            onLaunched={onLaunched}
            onClose={close}
          />
        ) : (
          <PickStep list={list} onNew={repo => setStep({ step: 'new', repo })} onClose={close} />
        )}
      </DialogContent>
    </Dialog>
  )
}
