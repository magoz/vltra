'use client'

import { useImperativeHandle, useMemo, useState } from 'react'
import type { Ref } from 'react'
import { useFleet } from '@/app/fleet-context'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxSearch,
  ComboboxTrigger,
  ComboboxValue
} from '@/components/ui/combobox'
import { buildProjectCards, projectName } from '@/lib/data/fleet/board'
import { cn } from '@/lib/utils'

/** What the page's `/` key reaches: opening the picker with its search field focused. */
export type ProjectFilterHandle = { readonly open: () => void }

/** A picker row: a project, or `null` for every project (no `?project=`). */
type ProjectOption = { readonly id: string | null; readonly name: string }

const allProjects: ProjectOption = { id: null, name: 'All projects' }

/**
 * The Agents and Stats pages' project filter (`?project=`): a searchable select (`/` opens it,
 * type to narrow the projects) and, while filtered, a chip with ×.
 */
export function ProjectFilter({
  filterRef,
  className
}: {
  readonly filterRef: Ref<ProjectFilterHandle>
  readonly className?: string
}) {
  const { view, nav } = useFleet()
  const [open, setOpen] = useState(false)

  useImperativeHandle(filterRef, () => ({ open: () => setOpen(true) }), [])

  const options = useMemo((): ReadonlyArray<ProjectOption> => {
    const projects = buildProjectCards(view).map(card => ({ id: card.id, name: card.name }))

    return nav.project === undefined || projects.some(project => project.id === nav.project)
      ? projects
      : [...projects, { id: nav.project, name: projectName(view, nav.project) }]
  }, [view, nav.project])

  const items = useMemo(() => [allProjects, ...options], [options])
  const current = options.find(project => project.id === nav.project)

  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2', className)}>
      <Combobox
        items={items}
        value={current ?? allProjects}
        onValueChange={option => nav.setProject(option?.id ?? undefined)}
        isItemEqualToValue={(item, value) => item.id === value.id}
        itemToStringLabel={option => option.name}
        open={open}
        onOpenChange={setOpen}
        autoHighlight
      >
        <div className="flex items-center gap-2">
          <ComboboxLabel>Project</ComboboxLabel>
          <ComboboxTrigger className="max-w-56">
            <ComboboxValue />
          </ComboboxTrigger>
        </div>
        <ComboboxContent aria-label="Projects">
          <ComboboxSearch placeholder="Search projects" aria-label="Search projects" />
          <ComboboxEmpty>No matching projects.</ComboboxEmpty>
          <ComboboxList>
            {(option: ProjectOption) => (
              <ComboboxItem key={option.id ?? ''} value={option}>
                {option.name}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
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
