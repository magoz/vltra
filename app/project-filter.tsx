'use client'

import { useMemo } from 'react'
import type { RefObject } from 'react'
import { useFleet } from '@/app/fleet-context'
import { buildProjectCards, projectName } from '@/lib/data/fleet/board'
import { cn } from '@/lib/utils'

/**
 * The Agents page's project filter (`?project=`, both modes): a select (`/` focuses it) and,
 * while filtered, a chip with ×.
 */
export function ProjectFilter({
  filterRef,
  className
}: {
  readonly filterRef: RefObject<HTMLSelectElement | null>
  readonly className?: string
}) {
  const { view, nav } = useFleet()

  const projects = useMemo(
    () => buildProjectCards(view).map(card => ({ id: card.id, name: card.name })),
    [view]
  )

  const options =
    nav.project === undefined || projects.some(project => project.id === nav.project)
      ? projects
      : [...projects, { id: nav.project, name: projectName(view, nav.project) }]

  const current = options.find(project => project.id === nav.project)

  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2', className)}>
      <label className="text-muted-foreground flex items-center gap-2 text-xs">
        <span>Project</span>
        <select
          ref={filterRef}
          value={nav.project ?? ''}
          onChange={event =>
            nav.setProject(event.target.value === '' ? undefined : event.target.value)
          }
          onKeyDown={event => {
            if (event.key !== 'Escape') return

            event.preventDefault()
            event.currentTarget.blur()
          }}
          className="border-input bg-background text-foreground focus-visible:ring-ring/50 h-7 border px-1.5 font-mono text-xs outline-none focus-visible:ring-[3px]"
        >
          <option value="">All projects</option>
          {options.map(project => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
      {current === undefined ? null : (
        <span className="border-foreground flex items-center gap-1 border py-0.5 pr-0.5 pl-2 text-xs">
          {current.name}
          <button
            type="button"
            aria-label={`Clear the ${current.name} filter`}
            onClick={() => nav.setProject(undefined)}
            className="hover:bg-accent focus-visible:ring-ring/50 flex size-5 items-center justify-center outline-none focus-visible:ring-[3px]"
          >
            ×
          </button>
        </span>
      )}
    </div>
  )
}
