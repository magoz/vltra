# anti-slop provenance

- Repository: https://github.com/dmmulroy/anti-slop
- Whole-install baseline: `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b`
- Canonical mapping: upstream `src/` → `tools/oxlint/anti-slop/`, including all 23
  RuleTester files and the separate spacing CLI test (not the generated skill assets).
- Root upstream `LICENSE` is copied beside this file: MIT, copyright 2026 Dillon Mulroy.
  `vendor/eslint-stylistic/LICENSE` and `vendor/eslint-stylistic/UPSTREAM.md` are retained
  verbatim and describe the separately adapted Stylistic engine and its copyright notices.
- Runtime: Node 24, exact `oxlint@1.78.0` and `@oxlint/plugins@1.78.0`.
- Both entry points are registered in the root `.oxlintrc.json`: all 18 generic and
  all 5 Effect rules are errors at upstream defaults. Application code is lint-clean under this
  policy. No rule-policy changes or legacy off overrides.

## Local deviations

1. Production `shared/dictionary-types.ts`: `unsafeMembers[0] ?? null` preserves the
   nullable return contract under 10x's `noUncheckedIndexedAccess`. No compiler flags relaxed;
   vendored production and test TypeScript remain in the root typecheck.
2. Test-only `rules/require-readable-spacing-cli.test.ts`: replace `pnpm exec oxlint`
   with `process.execPath` plus the repository's pinned `node_modules/oxlint/bin/oxlint`.
   pnpm 11's temporary-package dependency guard otherwise attempts installation and aborts
   without a TTY. All original rejection, exact fix, re-lint, and idempotence assertions remain.
3. This provenance file and the separately copied upstream root license are additions.

`../anti-slop.test.js` runs each upstream file in a separate native Node 24 process because
RuleTester assertions execute at import, not as Vitest suites. Only vendor discovery is excluded
from Vitest; the wrapper joins database-free `pnpm test:unit` and focused `pnpm test:lint`.
Vendor files are ignored by Oxlint/Oxfmt only, preserving upstream bytes outside the deviations.

## Recovering the pristine base and updating

Recover the exact base from the immutable commit, not the current branch or skill bundle:

```sh
git clone https://github.com/dmmulroy/anti-slop.git /tmp/anti-slop-upstream
git -C /tmp/anti-slop-upstream archive c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b src LICENSE > /tmp/anti-slop-base.tar
```

The initial copy was byte-compared against canonical `src/` before either deviation;
only the separately added root LICENSE differed. Reconstruct local source by extracting
`src/` and applying the two deviations above, then adding root LICENSE and this record.
The immutable git object is the recoverable base; no second active plugin source tree is kept.
Future updates: recover base, stage incoming separately, compare base→local and base→incoming,
merge reviewed changes, retain local deviations and both licenses, run upstream/CLI/root-reachability/
formatter/local-plugin tests and strict TypeScript. Never overwrite the local tree blindly.
Record unresolved conflicts; partial updates keep this whole-install baseline and list individual
incoming commits. Change source identity only when the installed bytes actually match it.
