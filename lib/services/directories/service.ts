import { Context } from 'effect'
import type { Effect } from 'effect'

/** Whether each checked directory is gone (`true`) or still there (`false`). */
export type DirectoryStatus = ReadonlyMap<string, boolean>

export type DirectoriesOperations = {
  /**
   * Checks each distinct directory on this machine (Fleet runs next to OpenCode). Missing and
   * not-a-directory count as gone; any other failure (permissions, I/O) counts as present, so a
   * session is never handled away because of a flaky check.
   */
  readonly check: (directories: Iterable<string>) => Effect.Effect<DirectoryStatus>
}

/**
 * Session folders on disk. OpenCode resolves a session's location with `realPath` for every
 * location-scoped call, so a session whose folder was deleted can no longer be written to.
 */
export class Directories extends Context.Service<Directories, DirectoriesOperations>()(
  '@fleet/Directories'
) {}
