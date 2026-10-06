'use client'

import dynamic from 'next/dynamic'
import { AgentsBoard } from '@/app/agents-board'
import { AgentsFocus } from '@/app/agents-focus'
import { useFleet } from '@/app/fleet-context'
import { ProjectsGrid } from '@/app/projects-grid'

// Charts (Recharts) load with the Stats tab, not with the dashboard.
const StatsPage = dynamic(() => import('@/app/stats-page').then(module => module.StatsPage), {
  ssr: false
})

/**
 * The tab in `?view=` (DESIGN.md "Clients" → Web): Focus (plain `/`), Agents (`?view=agents`,
 * the board), Projects or Stats. Tabs switch in place on the one page, so each mounts fresh and
 * none stays alive hidden.
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
    case 'stats':
      return <StatsPage />
  }
}
