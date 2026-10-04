'use client'

import { AgentsBoard } from '@/app/agents-board'
import { AgentsFocus } from '@/app/agents-focus'
import { useFleet } from '@/app/fleet-context'
import { ProjectsGrid } from '@/app/projects-grid'

/**
 * The tab in `?view=` (DESIGN.md "Clients" → Web): Focus (plain `/`), Agents (`?view=agents`,
 * the board) or Projects. Tabs switch in place on the one page, so each mounts fresh and none stays alive hidden.
 */
export function CurrentTab() {
  const { nav } = useFleet()

  switch (nav.screen) {
    case 'focus':
      return <AgentsFocus />
    case 'agents':
      return <AgentsBoard />
    case 'projects':
      return <ProjectsGrid />
  }
}
