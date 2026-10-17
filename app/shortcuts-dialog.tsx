'use client'

import type { VltraScreen } from '@/app/vltra-href'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

type KeyHint = { readonly keys: string; readonly label: string }

/**
 * Each tab's keys (`agents-focus.tsx`, `agents-board.tsx`, `projects-grid.tsx`, `stats-page.tsx`),
 * plus the shell's: `n` (the launcher, also `⌘K`), `1`–`5` and `⌘⌥1`–`⌘⌥5`
 * (the tabs), `⌘1`–`⌘9` (Focus' Nth session), `Escape` (close the session) and `?` / `⌘/` (this list), plus OpenCode's
 * own palette in the chat (`⌘P`).
 */
export const keyHints: Readonly<Record<VltraScreen, ReadonlyArray<KeyHint>>> = {
  focus: [
    { keys: 'j k', label: 'move' },
    { keys: '↵', label: 'open' },
    { keys: 'h ⌘D', label: 'done' },
    { keys: 'u ⌘U', label: 'undo' },
    { keys: 'n ⌘K', label: 'new' },
    { keys: '⌘1–9', label: 'Nth session (Focus)' },
    { keys: '1 2 3 4 5 ⌘⌥1–5', label: 'tabs' },
    { keys: 'i ⌘I', label: 'type in the chat' },
    { keys: 'esc', label: 'close the session' },
    { keys: '⌘P', label: "OpenCode's palette (in the chat)" },
    { keys: '? ⌘/', label: 'shortcuts' }
  ],
  agents: [
    { keys: 'j k', label: 'move' },
    { keys: '← →', label: 'column' },
    { keys: '↵', label: 'open' },
    { keys: 'h ⌘D', label: 'done' },
    { keys: 'u ⌘U', label: 'undo' },
    { keys: 'n ⌘K', label: 'new' },
    { keys: '/', label: 'filter' },
    { keys: '⌘1–9', label: 'Nth session (Focus)' },
    { keys: '1 2 3 4 5 ⌘⌥1–5', label: 'tabs' },
    { keys: 'i ⌘I', label: 'type in the chat' },
    { keys: 'esc', label: 'close the session' },
    { keys: '⌘P', label: "OpenCode's palette (in the chat)" },
    { keys: '? ⌘/', label: 'shortcuts' }
  ],
  projects: [
    { keys: '← → ↑ ↓', label: 'card' },
    { keys: 'j k', label: 'session' },
    { keys: '↵', label: 'open' },
    { keys: 'n ⌘K', label: 'new' },
    { keys: '⌘1–9', label: 'Nth session (Focus)' },
    { keys: '1 2 3 4 5 ⌘⌥1–5', label: 'tabs' },
    { keys: 'i ⌘I', label: 'type in the chat' },
    { keys: 'esc', label: 'close the session' },
    { keys: '⌘P', label: "OpenCode's palette (in the chat)" },
    { keys: '? ⌘/', label: 'shortcuts' }
  ],
  stats: [
    { keys: '[ ]', label: 'shorter / longer range' },
    { keys: '/', label: 'filter' },
    { keys: 'n ⌘K', label: 'new' },
    { keys: '⌘1–9', label: 'Nth session (Focus)' },
    { keys: '1 2 3 4 5 ⌘⌥1–5', label: 'tabs' },
    { keys: 'esc', label: 'close the session' },
    { keys: '? ⌘/', label: 'shortcuts' }
  ],
  settings: [
    { keys: 'n ⌘K', label: 'new' },
    { keys: '⌘1–9', label: 'Nth session (Focus)' },
    { keys: '1 2 3 4 5 ⌘⌥1–5', label: 'tabs' },
    { keys: '? ⌘/', label: 'shortcuts' }
  ]
}

const tabNames: Readonly<Record<VltraScreen, string>> = {
  focus: 'Focus',
  agents: 'Agents',
  projects: 'Projects',
  stats: 'Stats',
  settings: 'Settings'
}

/** The tab's keys (desktop), opened with `?` or the header's `?`; `Escape` closes it. */
export function ShortcutsDialog({
  screen,
  open,
  onOpenChange
}: {
  readonly screen: VltraScreen
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
