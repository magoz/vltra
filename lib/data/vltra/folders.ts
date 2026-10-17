import { Effect } from 'effect'
import { VltraEvent } from '@/lib/data/vltra/events'
import { applyEvent } from '@/lib/data/vltra/model'
import { VltraStore } from '@/lib/data/vltra/store'
import { Directories } from '@/lib/services/directories/service'

// Fresh folder checks for actions and session reads. OpenCode resolves a session's folder for
// every location-scoped call (`PATCH session`, diff), which fails once the folder is deleted, so
// callers skip those calls. The watcher re-checks every minute; checking at the call closes that
// window, and a changed answer is written back so the row flips at once.

/** Whether `directory` is gone from disk; a changed answer also updates the watcher's model. */
export const folderGone = (directory: string) =>
  Effect.gen(function* () {
    const directories = yield* Effect.flatMap(Directories, service => service.check([directory]))
    const gone = directories.get(directory) === true
    const store = yield* VltraStore
    const known = (yield* store.view).model.directoryGone.get(directory)

    if (known !== gone) {
      yield* store.commit(view => ({
        ...view,
        model: applyEvent(view.model, VltraEvent.DirectoriesChecked({ directories }))
      }))
    }

    return gone
  })

/** Whether a session's folder is gone; false for sessions the watcher does not know. */
export const sessionFolderGone = (sessionID: string) =>
  Effect.gen(function* () {
    const view = yield* Effect.flatMap(VltraStore, store => store.view)
    const session = view.model.sessions.get(sessionID)

    return session === undefined ? false : yield* folderGone(session.info.directory)
  })
