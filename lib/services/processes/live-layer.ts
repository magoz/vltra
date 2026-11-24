import { readdir, readFile, readlink } from 'node:fs/promises'
import { Effect, Layer } from 'effect'
import { Processes } from '@/lib/services/processes/service'

// Linux `/proc`: a process's children (`task/<tid>/children`), its open sockets (`fd/*` links
// to `socket:[inode]`), and the kernel's TCP tables (`net/tcp`, `net/tcp6`).

/** `st` of a listening socket in `/proc/net/tcp*`. */
const listenState = '0A'

/** No process tree Vltra checks is this big; the bound keeps a fork bomb from stalling it. */
const maxProcesses = 512

/**
 * The listening sockets of a `/proc/net/tcp` or `tcp6` table: socket inode → local port. Rows are
 * `sl local_address rem_address st … uid timeout inode …`, addresses `HEXIP:HEXPORT`.
 */
export const listeningSockets = (table: string): ReadonlyMap<string, number> =>
  new Map(
    table
      .split('\n')
      .slice(1)
      .flatMap(line => {
        const fields = line.trim().split(/\s+/)
        const port = Number.parseInt(fields[1]?.split(':')[1] ?? '', 16)
        const inode = fields[9]

        return fields[3] === listenState && Number.isInteger(port) && inode !== undefined
          ? [[inode, port] as const]
          : []
      })
  )

const socketInode = /^socket:\[(\d+)\]$/

/** Processes come and go mid-read (and others' are unreadable): any failure is `fallback`. */
const read = <A>(attempt: () => Promise<A>, fallback: A) =>
  Effect.promise(() => attempt().catch(() => fallback))

const text = (path: string) => read(() => readFile(path, 'utf8'), '')

const entries = (path: string) => read(() => readdir(path), [])

/** The process's direct children, from every one of its threads. */
const children = (pid: number) =>
  Effect.gen(function* () {
    const tasks = yield* entries(`/proc/${pid}/task`)

    const lists = yield* Effect.forEach(tasks, task => text(`/proc/${pid}/task/${task}/children`))

    return lists.flatMap(list =>
      list
        .split(/\s+/)
        .filter(item => item !== '')
        .map(Number)
    )
  })

/** The process and its descendants (breadth first, bounded). */
const tree = (pid: number) =>
  Effect.gen(function* () {
    const seen = new Set([pid])
    let frontier = [pid]

    while (frontier.length > 0 && seen.size < maxProcesses) {
      const next = (yield* Effect.forEach(frontier, children)).flat().filter(id => !seen.has(id))

      for (const id of next) seen.add(id)

      frontier = next
    }

    return Array.from(seen)
  })

/** Inodes of the sockets the process has open. */
const socketInodes = (pid: number) =>
  Effect.gen(function* () {
    const fds = yield* entries(`/proc/${pid}/fd`)

    const targets = yield* Effect.forEach(
      fds,
      fd => read(() => readlink(`/proc/${pid}/fd/${fd}`), ''),
      {
        concurrency: 16
      }
    )

    return targets.flatMap(target => {
      const inode = socketInode.exec(target)?.[1]

      return inode === undefined ? [] : [inode]
    })
  })

const portsOf = (pid: number, sockets: ReadonlyMap<string, number>) =>
  Effect.gen(function* () {
    const inodes = (yield* Effect.forEach(yield* tree(pid), socketInodes)).flat()

    return Array.from(
      new Set(
        inodes.flatMap(inode => {
          const port = sockets.get(inode)

          return port === undefined ? [] : [port]
        })
      )
    ).toSorted((left, right) => left - right)
  })

export const ProcessesLive = Layer.succeed(Processes, {
  listening: pids =>
    Effect.gen(function* () {
      const distinct = Array.from(new Set(pids))

      if (distinct.length === 0) return new Map()

      const tables = yield* Effect.forEach(['/proc/net/tcp', '/proc/net/tcp6'], text)
      const sockets = new Map(tables.flatMap(table => Array.from(listeningSockets(table))))

      const ports = yield* Effect.forEach(
        distinct,
        pid => Effect.map(portsOf(pid, sockets), found => [pid, found] as const),
        { concurrency: 4 }
      )

      return new Map(ports)
    })
})
