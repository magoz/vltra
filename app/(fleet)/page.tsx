import type { Metadata } from 'next'
import { Agents } from '@/app/agents'

export const metadata: Metadata = { title: 'Agents · Fleet' }

// Static: the page reads the live fleet, and its mode (`?view=`), from the layout's client tree.
export default function AgentsPage() {
  return <Agents />
}
