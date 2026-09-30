# Local Oxlint Rules

Small project-local Oxlint JavaScript plugin enforcing Effect/type-safety conventions from
`patterns/*`.

## Files

| File                     | Role                                                  |
| ------------------------ | ----------------------------------------------------- |
| `index.js`               | Default plugin export and named `localRulesPlugin`    |
| `no-*.js`, `prefer-*.js` | Individual ESLint-compatible JavaScript plugin rules  |
| `rules.test.js`          | Oxlint CLI integration assertions                     |
| `fixtures/`              | Valid/invalid syntax and path-sensitive parity corpus |
| `test.oxlintrc.json`     | Isolated local-rule test configuration                |
| `package.json`           | ESM marker only; not a pnpm workspace package         |

## Rule Conventions

- Add a local rule only for repeated, high-cost mistakes that docs cannot reliably prevent.
- Keep rules syntax-only; type-aware Oxlint is intentionally disabled.
- Keep messages actionable: name the forbidden pattern and the allowed replacement.
- Root `.oxlintrc.json` loads the default export through `jsPlugins`; edit `index.js` for additions.
- Touch root config only for scope/severity overrides.
- Update `AGENTS.md` and relevant `patterns/*` docs when adding/removing enforced rules.

## Current Limits

- Schema/Option/Effect-member rules are namespace-sensitive; aliases/direct imports may bypass them.
- `no-disable-validation` is repository-wide syntax matching any `disableValidation: true`, not only
  Schema calls.
- `prefer-option-from-nullable` is a warning; despite the name, Effect 4 replacement is
  `Option.fromNullishOr`.
- `no-node-deps-in-mcp-tools` excludes `.test.ts[x]` only. It derives bare builtins and subpaths from
  Node's module list, and also blocks `node:*`, `@effect/platform-node`, nonliteral dynamic imports,
  import-equals, and raw global `fetch()` forms.
- `rules.test.js` invokes the pinned Oxlint CLI over the committed corpus and verifies locations,
  messages, severities, rule IDs, root plugin loading, and legacy suppression namespaces. Namespace
  aliases and computed members remain intentionally outside syntax-only Effect/Schema matching.
- Oxlint's JavaScript plugin API is alpha; upgrade Oxlint only with this corpus passing.

## Anti-Patterns

- Type-aware rule without deliberately enabling and validating type services.
- Broad AST selector that flags unrelated libraries.
- Rule message with no migration path.
