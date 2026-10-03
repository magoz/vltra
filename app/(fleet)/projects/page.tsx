import type { Metadata } from 'next'
import { ProjectsGrid } from '@/app/projects-grid'

export const metadata: Metadata = { title: 'Projects · Fleet' }

// Static: the grid reads the live fleet from the layout's client tree.
export default function ProjectsPage() {
  return <ProjectsGrid />
}
