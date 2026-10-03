import type { Metadata } from 'next'
import { AgentsBoard } from '@/app/agents-board'

export const metadata: Metadata = { title: 'Agents · Fleet' }

// Static: the board reads the live fleet from the layout's client tree.
export default function AgentsPage() {
  return <AgentsBoard />
}
