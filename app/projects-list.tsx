'use client'

import { ProjectRow } from '@/app/session-row'
import type { ProjectGroup } from '@/lib/data/fleet/board'

type Selection = {
  readonly selected: string | undefined
  readonly onSelect: (sessionID: string) => void
}

function Project({
  project,
  now,
  selection
}: {
  readonly project: ProjectGroup
  readonly now: number
  readonly selection: Selection
}) {
  const count = project.worktrees.reduce((sum, worktree) => sum + worktree.rows.length, 0)

  return (
    <section aria-label={project.name} className="border-hairline border-t pt-2 pb-3">
      <h3 className="px-4 pb-1">
        <span className="font-semibold">{project.name}</span>
        <span className="text-muted-foreground"> · {count}</span>
      </h3>
      {project.worktrees.map(worktree => (
        <div key={worktree.directory}>
          {worktree.label === undefined ? null : (
            <h4 className="text-muted-foreground px-4 pt-1.5 pl-8 text-xs">
              {worktree.label} · {worktree.rows.length}
            </h4>
          )}
          <ul className={worktree.label === undefined ? undefined : 'pl-4'}>
            {worktree.rows.map(item => (
              <ProjectRow
                key={item.row.id}
                item={item}
                now={now}
                selected={item.row.id === selection.selected}
                showDirectory={project.other}
                onSelect={selection.onSelect}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

/**
 * Projects: every root session, no time limit, project → worktree by latest activity; in a
 * worktree, needs-me and working sessions first, then handled ones newest first. Sessions outside
 * any repository are one "Other" group, last.
 */
export function ProjectsList({
  projects,
  now,
  selection
}: {
  readonly projects: ReadonlyArray<ProjectGroup>
  readonly now: number
  readonly selection: Selection
}) {
  return (
    <div className="pb-8">
      <h2 className="text-muted-foreground px-4 pt-4 pb-1.5 text-xs tracking-widest uppercase max-lg:sr-only">
        Projects
      </h2>
      {projects.length === 0 ? (
        <p className="text-muted-foreground px-4 py-10 text-center">
          No OpenCode sessions yet. Start one in ocb; it shows up here live.
        </p>
      ) : (
        projects.map(project => (
          <Project key={project.id} project={project} now={now} selection={selection} />
        ))
      )}
    </div>
  )
}
