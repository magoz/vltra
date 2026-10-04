'use client'

import type { FleetScreen } from '@/app/fleet-href'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

type KeyHint = { readonly keys: string; readonly label: string }

/**
 * Each tab's keys (`agents-focus.tsx`, `agents-board.tsx`, `projects-grid.tsx`), plus the
 * shell's: `n` (the launcher, also `⌘K`), `b` (Focus ↔ Agents), `1` / `2` / `3` and `⌘⌥1`–`⌘⌥3`
 * (the tabs), `⌘1`–`⌘9` (Focus' Nth session), `Escape` (close the session) and `?` (this list).
 */
export const keyHints: Readonly<Record<FleetScreen, ReadonlyArray<KeyHint>>> = {
  focus: [
    { keys: 'j k', label: 'move' },
    { keys: '↵', label: 'open' },
    { keys: 'h ⌘D', label: 'done' },
    { keys: 'u', label: 'undo' },
    { keys: 'b', label: 'agents' },
    { keys: 'n ⌘K', label: 'new' },
    { keys: '⌘1–9', label: 'Nth session (Focus)' },
    { keys: '1 2 3 ⌘⌥1–3', label: 'tabs' },
    { keys: 'esc', label: 'close the session' },
    { keys: '?', label: 'shortcuts' }
  ],
  agents: [
    { keys: 'j k', label: 'move' },
    { keys: '← →', label: 'column' },
    { keys: '↵', label: 'open' },
    { keys: 'h ⌘D', label: 'done' },
    { keys: 'u', label: 'undo' },
    { keys: 'b', label: 'focus' },
    { keys: 'n ⌘K', label: 'new' },
    { keys: '/', label: 'filter' },
    { keys: '⌘1–9', label: 'Nth session (Focus)' },
    { keys: '1 2 3 ⌘⌥1–3', label: 'tabs' },
    { keys: 'esc', label: 'close the session' },
    { keys: '?', label: 'shortcuts' }
  ],
  projects: [
    { keys: '← → ↑ ↓', label: 'card' },
    { keys: 'j k', label: 'session' },
    { keys: '↵', label: 'open' },
    { keys: 'n ⌘K', label: 'new' },
    { keys: '⌘1–9', label: 'Nth session (Focus)' },
    { keys: '1 2 3 ⌘⌥1–3', label: 'tabs' },
    { keys: 'esc', label: 'close the session' },
    { keys: '?', label: 'shortcuts' }
  ]
}

const tabNames: Readonly<Record<FleetScreen, string>> = {
  focus: 'Focus',
  agents: 'Agents',
  projects: 'Projects'
}

/** The tab's keys (desktop), opened with `?` or the header's `?`; `Escape` closes it. */
export function ShortcutsDialog({
  screen,
  open,
  onOpenChange
}: {
  readonly screen: FleetScreen
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[12vh] left-1/2 w-[22rem] -translate-x-1/2 gap-3 p-4">
        <DialogTitle>Keys · {tabNames[screen]}</DialogTitle>
        <dl
          aria-label="Keyboard shortcuts"
          className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-xs"
        >
          {keyHints[screen].map(hint => (
            <div key={hint.keys} className="contents">
              <dt>
                <kbd className="font-mono">{hint.keys}</kbd>
              </dt>
              <dd className="text-muted-foreground">{hint.label}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  )
}
