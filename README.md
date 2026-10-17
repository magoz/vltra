# Vltra

One view of every [OpenCode](https://opencode.ai) session on a machine, built around attention:
which sessions need you (blocked on a permission or question, or finished and not yet handled),
which are working (and which look stuck), grouped by project and worktree. Open any session's
chat inline, mark it done, move to the next one.

- **Focus**: only what needs you; `h` marks the open session done and opens the next.
- **Agents**: a board, `Need you | Working | Done`.
- **Projects**: every project and worktree, with PR status; retire merged worktrees.
- **Stats**: charts of OpenCode's own usage data.
- **Launcher** (`⌘K`): new session, or new worktree + task with a suggested branch name.
- Web Push notifications, installable on the phone.

Vltra is an OpenCode API client. It stores nothing of its own: the "done" marker lives in the
session's OpenCode metadata (`metadata.vltra.handled`). See [`DESIGN.md`](DESIGN.md) for the full
spec and [`AGENTS.md`](AGENTS.md) for the code map.

## Security

**There is no login.** Vltra is for one user and must only be reachable on a private network
(e.g. a Tailscale tailnet). Anyone who can reach it can read session titles, start and delete
sessions, and create or remove worktrees. Mutations reject cross-site requests, and the OpenCode
chat it proxies keeps OpenCode's own auth (`opencode pair`).

## Requirements

- Node 24, pnpm 11
- OpenCode **2.0.20** running as a service on the same machine (`opencode serve --service`);
  Vltra discovers it and never starts one
- `git`, and `gh` (logged in) for PR status
- HTTPS in front of it for the phone and Web Push (e.g. Caddy)

## Run

```bash
pnpm install
pnpm dev                                    # https://vltra.localhost (portless)
pnpm build && pnpm start -H 127.0.0.1 -p 3940
```

For development against a throwaway OpenCode server, set `OPENCODE_URL` / `OPENCODE_PASSWORD`.

## Configure

| Variable                 | Default                           | Purpose                                                           |
| ------------------------ | --------------------------------- | ----------------------------------------------------------------- |
| `VLTRA_OPENCODE_WEB_URL` | `https://vltra.localhost`         | Vltra's public origin (it serves OpenCode's web UI from there)    |
| `VLTRA_LAUNCHER_ROOTS`   | `~/dev/repos`                     | `:`-separated launcher roots: a repo, a folder of repos, a folder |
| `VLTRA_BRANCH_MODEL`     | `opencode-go/qwen3.8-flash#none`  | Model for branch-name suggestions                                 |
| `VLTRA_USAGE_URL`        | `http://127.0.0.1:8320`           | Optional [usage](https://github.com/magoz/usage) dashboard        |
| `VLTRA_PUSH_FILE`        | `$XDG_STATE_HOME/vltra/push.json` | Web Push keys and devices                                         |
| `VLTRA_LAUNCHER`         | `opencode`                        | `watcher` to run launches in a Watcher daemon                     |

All variables: [`AGENTS.md`](AGENTS.md#configuration).

## Develop

```bash
pnpm verify   # format + typecheck + lint + test + build
```

The integration suite starts an isolated `opencode serve` 2.0.20 (skipped if the binary is
missing) and never touches a live service.

## License

[MIT](LICENSE)
