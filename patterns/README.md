# Patterns

Fleet follows the 10x patterns (`../10x/patterns/`) for Effect, TypeScript, linting, testing and
Cache Components pages. Read those first; the notes here cover only where Fleet differs.

| Pattern                                          | Purpose                                                        |
| ------------------------------------------------ | -------------------------------------------------------------- |
| [LONG_LIVED_WATCHER.md](./LONG_LIVED_WATCHER.md) | The OpenCode watcher inside Next: runtime, resync, cache tags  |
| [OPENCODE_SURFACE.md](./OPENCODE_SURFACE.md)     | OpenCode endpoints, events, handled marker, and test isolation |

Differences from 10x at a glance:

- No auth and no database; OpenCode is the only source of truth.
- Effect `4.0.0-rc.112` (the version `@opencode/client@2.0.20` requires), so `@effect/vitest`
  rc.112 and Vitest 4 (its peer range), not Vitest 5.
- No `NextEffect` helpers: nothing redirects. Boundaries call `runFleet` on the shared runtime.
- Server actions return `FleetActionResult` through the shared `toActionResult` tail
  (`app/fleet-action-result.ts`) instead of per-action catch chains; the terminal plugin's JSON
  mutation routes reuse its messages (`failureMessage`) through `toMutationResponse`
  (`app/api/fleet/mutations.ts`), which adds HTTP statuses.
