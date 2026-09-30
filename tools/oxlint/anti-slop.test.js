// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

const vendor = path.join(root, 'tools/oxlint/anti-slop')

const oxlint = path.join(root, 'node_modules/oxlint/bin/oxlint')

const oxfmt = path.join(root, 'node_modules/oxfmt/bin/oxfmt')

const rootConfig = path.join(root, '.oxlintrc.json')

// An independent manifest: dropping a registration or upstream suite must fail this test.
const genericProbes = {
  'no-array-filter-map': '[].filter(active).map(email)',
  'no-reduce-accumulator-copy': 'items.reduce(acc => Object.assign({}, acc), {})',
  'no-chained-type-assertions': 'const value = input as unknown as string',
  'no-conditional-empty-object-spread': 'const value = { ...(enabled ? { id: 1 } : {}) }',
  'no-known-value-widening': 'const value: unknown = {}',
  'no-module-mocking': "import { vi } from 'vitest'\n\nvi.mock('example')",
  'no-object-parameters': 'function use(value: object) { return value }',
  'no-reflect-apply': 'Reflect.apply(fn, receiver, args)',
  'no-reflect-get': "Reflect.get(value, 'id')",
  'no-runtime-typeof': "const result = typeof value === 'string'",
  'no-shape-in-symbol-names': 'type UserShape = string',
  'no-unknown-parameters': 'function use(value: unknown) { return value }',
  'no-unknown-returns': 'declare function read(): unknown',
  'no-unknown-type-aliases': 'type Value = unknown',
  'no-unsafe-dictionary-type': 'type Values = Record<string, unknown>',
  'no-widen-then-assert':
    "const source = { id: 'second' }; const widened: unknown = source; const parsed = widened as { readonly id: string };",
  'require-readable-spacing': 'export const a = 1\nexport const b = 2',
  'require-safety-comment-for-type-assertion': 'const value = input as string'
}

const effectProbes = {
  'no-manual-effect-error-tag': "Effect.catch(error => error._tag === 'NotFound' ? recover : fail)",
  'no-manual-tag-comparison': "const ready = value._tag === 'Ready'",
  'no-manual-tagged-construction': "const value = { _tag: 'Ready' }",
  'no-service-constructor-imports': "import { makeIssueService } from './issue-service.ts'",
  'prefer-effect-match': "const value = kind === 'a' ? first : kind === 'b' ? second : fallback"
}

const probes = [
  ...Object.entries(genericProbes).map(([rule, source]) => ({
    namespace: 'anti-slop',
    rule,
    source,
    suite: `rules/${rule}.test.ts`
  })),
  ...Object.entries(effectProbes).map(([rule, source]) => ({
    namespace: 'anti-slop-effect',
    rule,
    source,
    suite: `effect/rules/${rule}.test.ts`
  }))
]

const execute = (binary, args) =>
  spawnSync(process.execPath, [binary, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000
  })

const spacingSources = {
  'comments.ts': 'export const a = 1; // trailing\n/** Attached to b. */\nexport const b = 2;\n',
  'overloads.ts':
    'export function f(a: string): string;\nexport function f(a: number): number;\nexport function f(a: string | number) { return a; }\n',
  'asi.ts': 'const a = 1\n;[1].forEach(f)\n',
  'generator.ts':
    "const f = Effect.gen(function* () {\nconst a = yield* A;\nconst b = yield* B;\nconst dispatch = Effect.fn('dispatch')(function* () {\nyield* a;\n});\nreturn dispatch;\n});\n",
  'control.ts': 'function f() {\nif (ok) { go(); }\nstop();\nwhile (ok) go();\nreturn 1;\n}\n',
  'wrapping.tsx':
    'export function Example() {\nconst config = { firstLongProperty: "first long value here", secondLongProperty: "second long value here", thirdLongProperty: "third long value here" }\nconst label = config.firstLongProperty\nreturn <div>{label}</div>\n}\n'
}

describe('vendored anti-slop integration', () => {
  it('pins Node 24 and the plugin API pair and accounts for every upstream suite', () => {
    expect(process.versions.node.split('.')[0]).toBe('24')

    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))

    expect(pkg.devDependencies.oxlint).toBe('1.78.0')
    expect(pkg.devDependencies['@oxlint/plugins']).toBe('1.78.0')
    expect(probes).toHaveLength(23)

    const files = readdirSync(vendor, { recursive: true })
      .filter(file => file.endsWith('.test.ts'))
      .toSorted()

    expect(files).toEqual(
      [...probes.map(probe => probe.suite), 'rules/require-readable-spacing-cli.test.ts'].toSorted()
    )

    const config = JSON.parse(readFileSync(rootConfig, 'utf8'))
    const enabled = Object.keys(config.rules).filter(rule => rule.startsWith('anti-slop'))

    expect(enabled.toSorted()).toEqual(
      probes.map(probe => `${probe.namespace}/${probe.rule}`).toSorted()
    )

    for (const rule of enabled) {
      expect(config.rules[rule]).toBe('error')
    }

    // External probe paths do not exercise repo-relative overrides. Guard those separately.
    for (const override of config.overrides ?? []) {
      expect(
        Object.keys(override.rules ?? {}).filter(rule => rule.startsWith('anti-slop'))
      ).toEqual([])
    }
  })

  it.each([...probes.map(probe => probe.suite), 'rules/require-readable-spacing-cli.test.ts'])(
    'executes native Node RuleTester/CLI assertions: %s',
    suite => {
      const result = execute(path.join(vendor, suite), [])

      expect(result.error).toBeUndefined()
      expect(result.signal).toBeNull()
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    }
  )

  it.each(probes)('reaches $namespace/$rule as an error through the actual root config', probe => {
    const directory = mkdtempSync(path.join(tmpdir(), '10x-anti-slop-reachability-'))
    const filename = path.join(directory, 'runtime.ts')

    try {
      writeFileSync(filename, `${probe.source}\n`)

      const result = execute(oxlint, ['--config', rootConfig, '--format', 'json', filename])

      expect(result.error).toBeUndefined()
      expect(result.signal).toBeNull()
      expect(result.status, result.stderr).toBe(1)

      const output = JSON.parse(result.stdout)

      expect(output.diagnostics).toContainEqual(
        expect.objectContaining({
          code: `${probe.namespace}(${probe.rule})`,
          severity: 'error',
          filename
        })
      )
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('accepts compliant code with all plugins loaded and honors upstream path-sensitive defaults', () => {
    const directory = mkdtempSync(path.join(tmpdir(), '10x-anti-slop-valid-'))
    const filename = path.join(directory, 'service.test.ts')

    try {
      writeFileSync(
        filename,
        "import { makeIssueService } from './issue-service.ts'\n\nexport const value = makeIssueService()\n"
      )

      const result = execute(oxlint, ['--config', rootConfig, '--format', 'json', filename])

      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
      expect(JSON.parse(result.stdout).diagnostics).toEqual([])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('converges Oxfmt and spacing fixes without detaching comments, overloads, or ASI protection', () => {
    const directory = mkdtempSync(path.join(tmpdir(), '10x-anti-slop-format-'))
    const config = path.join(directory, 'spacing.json')
    const files = Object.keys(spacingSources).map(name => path.join(directory, name))

    try {
      writeFileSync(
        config,
        JSON.stringify({
          categories: { correctness: 'off' },
          jsPlugins: [{ name: 'anti-slop', specifier: path.join(vendor, 'index.ts') }],
          rules: { 'anti-slop/require-readable-spacing': 'error' }
        })
      )

      for (const [name, source] of Object.entries(spacingSources)) {
        writeFileSync(path.join(directory, name), source)
      }

      const formatArgs = ['--config', path.join(root, '.oxfmtrc.json'), '--write', ...files]
      const lintArgs = ['--config', config, ...files]
      const normalized = execute(oxfmt, formatArgs)

      expect(normalized.status, normalized.stderr).toBe(0)

      const rejected = execute(oxlint, lintArgs)

      expect(rejected.status).toBe(1)
      expect(rejected.stdout).toContain('require-readable-spacing')

      let previous = []
      let stable = false

      for (let pass = 0; pass < 4; pass += 1) {
        const fixed = execute(oxlint, ['--fix', ...lintArgs])
        const formatted = execute(oxfmt, formatArgs)
        const clean = execute(oxlint, lintArgs)
        const current = files.map(file => readFileSync(file, 'utf8'))

        expect(fixed.status, `${fixed.stdout}\n${fixed.stderr}`).toBe(0)
        expect(formatted.status, formatted.stderr).toBe(0)

        if (clean.status === 0 && current.every((text, index) => text === previous[index])) {
          stable = true
          break
        }

        previous = current
      }

      expect(stable).toBe(true)
      expect(readFileSync(path.join(directory, 'comments.ts'), 'utf8')).toBe(
        'export const a = 1 // trailing\n\n/** Attached to b. */\nexport const b = 2\n'
      )
      expect(readFileSync(path.join(directory, 'overloads.ts'), 'utf8')).toBe(
        'export function f(a: string): string\nexport function f(a: number): number\nexport function f(a: string | number) {\n  return a\n}\n'
      )
      expect(readFileSync(path.join(directory, 'asi.ts'), 'utf8')).toBe(
        'const a = 1\n\n;[1].forEach(f)\n'
      )
      expect(readFileSync(path.join(directory, 'wrapping.tsx'), 'utf8')).toContain(
        '}\n\n  const label ='
      )
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
