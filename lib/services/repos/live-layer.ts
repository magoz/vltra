import path from 'node:path'
import { homedir } from 'node:os'
import * as NodeChildProcessSpawner from '@effect/platform-node/NodeChildProcessSpawner'
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem'
import * as NodePath from '@effect/platform-node/NodePath'
import {
  Clock,
  Config,
  Deferred,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Option,
  Ref,
  Semaphore,
  Stream
} from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process'
import type { PullRequest, RepoCheckout, RepoWorktree } from '@/lib/data/fleet/types'
import {
  gitDirOf,
  launcherRoots,
  markerFile,
  markerOwner,
  parsePullRequests,
  parseWorktreeList,
  unknownPullRequest
} from '@/lib/services/repos/git'
import { Repos } from '@/lib/services/repos/service'
import type { CheckoutInfo, ReposOperations } from '@/lib/services/repos/service'

export type ReposOptions = {
  /** Launcher roots, absolute: each a repository, or a folder of repositories. */
  readonly roots: ReadonlyArray<string>
  /** Extra environment for `git` and `gh` (tests put a fake `gh` first on `PATH`). */
  readonly env?: Readonly<Record<string, string>>
  /** How long a PR status stays cached. */
  readonly prTtl?: Duration.Input
  /** How long `pullRequest` waits for a lookup that is not cached yet. */
  readonly prWait?: Duration.Input
}

const gitTimeout = Duration.seconds(10)

const ghTimeout = Duration.seconds(15)

/** Repositories inspected at once (one `git worktree list` each). */
const scanConcurrency = 8

/** `gh` processes at once (each is a GitHub API call). */
const ghConcurrency = 4

type Output = { readonly stdout: string; readonly exitCode: number }

const quietEnv = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
  GH_PROMPT_DISABLED: '1',
  GH_NO_UPDATE_NOTIFIER: '1',
  NO_COLOR: '1'
}

export const makeRepos = (options: ReposOptions) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const scope = yield* Effect.scope
    const env = { ...quietEnv, ...options.env }
    const prTtl = Duration.toMillis(Duration.fromInputUnsafe(options.prTtl ?? '5 minutes'))
    const prWait = options.prWait ?? '2500 millis'
    const ghPermits = yield* Semaphore.make(ghConcurrency)

    /** Runs a command (argv, no shell): its stdout and exit code; none on failure or timeout. */
    const run = (
      command: string,
      args: ReadonlyArray<string>,
      cwd: string,
      timeout: Duration.Duration
    ): Effect.Effect<Option.Option<Output>> =>
      Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* ChildProcess.make(command, args, {
            cwd,
            env,
            extendEnv: true,
            stdin: 'ignore',
            stderr: 'ignore'
          })

          const [stdout, exitCode] = yield* Effect.all(
            [handle.stdout.pipe(Stream.decodeText, Stream.mkString), handle.exitCode],
            { concurrency: 2 }
          )

          const output: Output = { stdout, exitCode }

          return Option.some(output)
        })
      ).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.timeout(timeout),
        Effect.catch(error =>
          Effect.logDebug('Command failed', command, args.join(' '), error.message).pipe(
            Effect.as(Option.none<Output>())
          )
        )
      )

    /** stdout of a successful run; none otherwise. */
    const succeeded = (output: Option.Option<Output>) =>
      Option.flatMap(output, value =>
        value.exitCode === 0 ? Option.some(value.stdout) : Option.none()
      )

    const git = (cwd: string, args: ReadonlyArray<string>) =>
      Effect.map(run('git', args, cwd, gitTimeout), succeeded)

    const option = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<Option.Option<A>> =>
      effect.pipe(
        Effect.map(Option.some),
        Effect.orElseSucceed(() => Option.none<A>())
      )

    const kind = (target: string) =>
      Effect.map(option(fs.stat(target)), info => Option.map(info, value => value.type))

    /** `.git` of a candidate: a directory for a primary checkout, a file for a linked worktree. */
    const dotGitKind = (directory: string) => kind(path.join(directory, '.git'))

    const isPrimary = (directory: string) =>
      Effect.map(dotGitKind(directory), type => Option.contains(type, 'Directory'))

    /** A root: itself when it is a repository (or a linked worktree), else its child folders. */
    const candidates = (root: string) =>
      Effect.gen(function* () {
        if (!Option.contains(yield* kind(root), 'Directory')) return []

        if (Option.isSome(yield* dotGitKind(root))) return [root]

        const children = Option.getOrElse(yield* option(fs.readDirectory(root)), () => [])

        return children
          .filter(child => !child.startsWith('.'))
          .toSorted()
          .map(child => path.join(root, child))
      })

    /** The linked worktree's owner, from the marker in its private git dir. */
    const ownerOf = (directory: string, branch: string | undefined) =>
      Effect.gen(function* () {
        const dotGit = yield* option(fs.readFileString(path.join(directory, '.git')))
        const gitDir = Option.flatMap(dotGit, text => gitDirOf(directory, text))

        const marker = Option.isNone(gitDir)
          ? Option.none<string>()
          : yield* option(fs.readFileString(path.join(gitDir.value, markerFile)))

        return markerOwner(marker, branch)
      })

    const checkout = (directory: string) =>
      Effect.gen(function* () {
        const listed = yield* git(directory, ['worktree', 'list', '--porcelain', '-z'])

        if (Option.isNone(listed)) return Option.none<RepoCheckout>()

        const [primary, ...linked] = parseWorktreeList(listed.value)

        if (primary === undefined) return Option.none<RepoCheckout>()

        const worktrees = yield* Effect.forEach(
          linked.filter(worktree => !worktree.bare && !worktree.prunable),
          worktree =>
            Effect.map(ownerOf(worktree.directory, worktree.branch), (owner): RepoWorktree => ({
              directory: worktree.directory,
              branch: worktree.branch,
              owner
            })),
          { concurrency: 4 }
        )

        const repo: RepoCheckout = {
          name: path.basename(directory),
          directory,
          worktrees: worktrees.toSorted((left, right) =>
            left.directory.localeCompare(right.directory)
          )
        }

        return Option.some(repo)
      })

    const list: ReposOperations['list'] = extra =>
      Effect.gen(function* () {
        const found = yield* Effect.forEach(options.roots, candidates, { concurrency: 4 })

        const directories = yield* Effect.forEach(
          [...found.flat(), ...extra],
          candidate =>
            Effect.gen(function* () {
              if (!path.isAbsolute(candidate) || !(yield* isPrimary(candidate))) {
                return Option.none<string>()
              }

              return yield* option(fs.realPath(candidate))
            }),
          { concurrency: scanConcurrency }
        )

        const unique = Array.from(new Set(directories.flatMap(Option.toArray)))

        const repos = yield* Effect.forEach(unique, checkout, { concurrency: scanConcurrency })

        return repos.flatMap(Option.toArray)
      }).pipe(Effect.withSpan('repos.list'))

    const inspect: ReposOperations['inspect'] = directory =>
      Effect.gen(function* () {
        if (!path.isAbsolute(directory)) return Option.none<CheckoutInfo>()

        const real = yield* option(fs.realPath(directory))

        if (Option.isNone(real)) return Option.none<CheckoutInfo>()

        const parsed = yield* git(real.value, [
          'rev-parse',
          '--path-format=absolute',
          '--show-toplevel',
          '--absolute-git-dir',
          '--git-common-dir'
        ])

        const [top, gitDir, commonDir] = Option.getOrElse(parsed, () => '')
          .split('\n')
          .map(line => line.trim())

        if (top !== real.value || gitDir === undefined || commonDir === undefined) {
          return Option.none<CheckoutInfo>()
        }

        const branch = Option.map(
          yield* git(real.value, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
          text => text.trim()
        )

        const linked = gitDir !== commonDir
        const branchName = Option.getOrUndefined(Option.filter(branch, name => name !== ''))

        const info: CheckoutInfo = {
          directory: real.value,
          primary: path.basename(commonDir) === '.git' ? path.dirname(commonDir) : real.value,
          linked,
          branch: branchName,
          owner: linked ? yield* ownerOf(real.value, branchName) : 'other'
        }

        return Option.some(info)
      })

    type Lookup = { readonly startedAt: number; readonly result: Deferred.Deferred<PullRequest> }

    const lookups = yield* Ref.make<ReadonlyMap<string, Lookup>>(new Map())

    const lookupPullRequest = (repo: string, branch: string) =>
      ghPermits.withPermits(1)(
        run(
          'gh',
          [
            'pr',
            'list',
            '--head',
            branch,
            '--state',
            'all',
            '--json',
            'number,state,url,closingIssuesReferences',
            '--limit',
            '1'
          ],
          repo,
          ghTimeout
        ).pipe(
          Effect.map(output =>
            Option.match(succeeded(output), {
              onNone: () => unknownPullRequest,
              onSome: parsePullRequests
            })
          )
        )
      )

    /** The cached lookup for a key, or a new one forked into the layer's scope. */
    const lookup = (repo: string, branch: string) =>
      Effect.gen(function* () {
        const key = `${repo}\0${branch}`
        const now = yield* Clock.currentTimeMillis
        const known = (yield* Ref.get(lookups)).get(key)

        if (known !== undefined && now - known.startedAt < prTtl) return known.result

        const result = yield* Deferred.make<PullRequest>()

        yield* Ref.update(lookups, map => {
          const next = new Map(Array.from(map).filter(([, entry]) => now - entry.startedAt < prTtl))

          return next.set(key, { startedAt: now, result })
        })

        yield* lookupPullRequest(repo, branch).pipe(
          Effect.flatMap(status => Deferred.succeed(result, status)),
          Effect.forkIn(scope)
        )

        return result
      })

    const pullRequest: ReposOperations['pullRequest'] = ({ repo, branch }) =>
      Effect.flatMap(lookup(repo, branch), result =>
        Deferred.await(result).pipe(
          Effect.timeoutOrElse({
            duration: prWait,
            orElse: () => Effect.succeed(unknownPullRequest)
          })
        )
      )

    const operations: ReposOperations = { list, inspect, pullRequest }

    return operations
  })

const HomeDirectory = Config.string('HOME').pipe(Config.withDefault(homedir()))

/** Launcher roots from `FLEET_LAUNCHER_ROOTS` (read once, when the layer is built). */
export const ReposLive = Layer.effect(
  Repos,
  Effect.gen(function* () {
    const configured = yield* Config.option(Config.string('FLEET_LAUNCHER_ROOTS'))
    const home = yield* HomeDirectory

    return yield* makeRepos({ roots: launcherRoots(configured, home) })
  }).pipe(Effect.orDie)
).pipe(
  Layer.provide(NodeChildProcessSpawner.layer),
  Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))
)
