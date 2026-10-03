'use client'

import { subagentName } from '@/app/fleet-format'
import { FormAsk } from '@/app/form-ask'
import { PermissionAsk } from '@/app/permission-ask'
import type { FleetRow, PendingPermission } from '@/lib/data/fleet/types'

const sources = (row: FleetRow) => [
  { session: row, subagent: undefined },
  ...row.children.map(child => ({ session: child, subagent: subagentName(child) }))
]

/** The first pending permission in the row's subtree (the `a` / `d` keys answer it). */
export const firstPermission = (row: FleetRow): PendingPermission | undefined =>
  sources(row)
    .flatMap(({ session }) => session.permissions)
    .at(0)

/**
 * Pending permissions and forms across the row's subtree, answered in place. A subagent's
 * requests read `subagent <agent> asks: …`.
 */
export function PendingAsks({ row }: { readonly row: FleetRow }) {
  return (
    <div className="space-y-4">
      {sources(row).flatMap(({ session, subagent }) => [
        ...session.permissions.map(permission => (
          <PermissionAsk key={permission.id} permission={permission} subagent={subagent} />
        )),
        ...session.forms.map(form => <FormAsk key={form.id} form={form} subagent={subagent} />)
      ])}
    </div>
  )
}
