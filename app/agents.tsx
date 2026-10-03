'use client'

import { AgentsBoard } from '@/app/agents-board'
import { AgentsFocus } from '@/app/agents-focus'
import { useFleet } from '@/app/fleet-context'

/**
 * The Agents page in its mode (DESIGN.md "Clients" → Web): focus (the default, plain `/`), or the
 * board (`?view=board`). The header's Focus | Board toggle and `b` switch.
 */
export function Agents() {
  const { nav } = useFleet()

  return nav.view === 'board' ? <AgentsBoard /> : <AgentsFocus />
}
