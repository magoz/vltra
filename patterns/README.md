# Patterns

The conventions in `AGENTS.md` ("CONVENTIONS", "TESTS") apply everywhere; these notes cover the
parts that need more than a line.

| Pattern                                          | Purpose                                                        |
| ------------------------------------------------ | -------------------------------------------------------------- |
| [LONG_LIVED_WATCHER.md](./LONG_LIVED_WATCHER.md) | The OpenCode watcher inside Next: runtime, resync, cache tags  |
| [OPENCODE_SURFACE.md](./OPENCODE_SURFACE.md)     | OpenCode endpoints, events, handled marker, and test isolation |

At a glance:

- No auth and no database; OpenCode is the only source of truth.
- Effect `4.0.0-rc.112` (the version `@opencode/client@2.0.20` requires), so `@effect/vitest`
  rc.112 and Vitest 4 (its peer range), not Vitest 5.
- Boundaries (routes, actions, the page) call `runVltra` on the shared runtime; nothing redirects.
- Server actions return `VltraActionResult` through the shared `toActionResult` tail
  (`app/vltra-action-result.ts`) instead of per-action catch chains; the terminal plugin's JSON
  mutation routes reuse its messages (`failureMessage`) through `toMutationResponse`
  (`app/api/vltra/mutations.ts`), which adds HTTP statuses.
- Strict TypeScript: no `any`, no non-null `!`, no casts; parse unknown input with Effect Schema;
  fake services with typed layers (`vi.mock` is a lint error).
