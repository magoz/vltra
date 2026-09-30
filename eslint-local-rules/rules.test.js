import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const oxlintPath = path.join(process.cwd(), 'node_modules', '.bin', 'oxlint')

const runOxlint = (args, expectedStatus = 1) => {
  const result = spawnSync(oxlintPath, args, {
    cwd: process.cwd(),
    encoding: 'utf8'
  })

  if (result.error !== undefined || result.signal !== null) {
    throw new Error(
      `Oxlint process failed to run: ${result.error?.message ?? `signal ${result.signal}`}`
    )
  }

  let output

  try {
    output = JSON.parse(result.stdout)
  } catch (error) {
    throw new Error(
      [
        `Oxlint returned non-JSON output (status ${String(result.status)}).`,
        `stdout: ${result.stdout}`,
        `stderr: ${result.stderr}`,
        `parse error: ${error instanceof Error ? error.message : String(error)}`
      ].join('\n')
    )
  }

  if (result.status !== expectedStatus || !Array.isArray(output.diagnostics)) {
    throw new Error(
      [
        `Unexpected Oxlint result (expected status ${expectedStatus}, got ${String(result.status)}).`,
        `stdout: ${result.stdout}`,
        `stderr: ${result.stderr}`
      ].join('\n')
    )
  }

  return output.diagnostics
}

const diagnosticSummary = diagnostic => ({
  code: diagnostic.code,
  file: diagnostic.filename.replaceAll('\\', '/'),
  line: diagnostic.labels[0]?.span.line,
  message: diagnostic.message,
  severity: diagnostic.severity
})

const expectedCorpusDiagnostics = [
  {
    code: 'local(no-disable-validation)',
    file: 'eslint-local-rules/fixtures/invalid/local-rules.ts',
    line: 2,
    message:
      'Never use { disableValidation: true }. Fix the data or schema instead. See patterns/EFFECT_BEST_PRACTICES.md',
    severity: 'error'
  },
  {
    code: 'local(no-catch-cause)',
    file: 'eslint-local-rules/fixtures/invalid/local-rules.ts',
    line: 3,
    message:
      'Avoid Effect.catchCause - it catches defects (bugs) that should crash. Use Effect.catch or Effect.mapError to only catch expected errors. See patterns/EFFECT_BEST_PRACTICES.md',
    severity: 'error'
  },
  {
    code: 'local(no-catch-cause)',
    file: 'eslint-local-rules/fixtures/invalid/local-rules.ts',
    line: 4,
    message:
      'Avoid Effect.catchAllCause - it catches defects (bugs) that should crash. Use Effect.catch or Effect.mapError to only catch expected errors. See patterns/EFFECT_BEST_PRACTICES.md',
    severity: 'error'
  },
  {
    code: 'local(no-schema-from-self)',
    file: 'eslint-local-rules/fixtures/invalid/local-rules.ts',
    line: 5,
    message:
      'Schema.OptionFromSelf does not exist in Effect v4. Use Schema.Option instead. See patterns/EFFECT_BEST_PRACTICES.md',
    severity: 'error'
  },
  {
    code: 'local(no-schema-decode-sync)',
    file: 'eslint-local-rules/fixtures/invalid/local-rules.ts',
    line: 6,
    message:
      'Avoid Schema.decodeUnknownSync - it throws exceptions. Use Schema.decodeUnknownEffect which returns an Effect. See patterns/EFFECT_BEST_PRACTICES.md',
    severity: 'error'
  },
  {
    code: 'local(prefer-option-from-nullable)',
    file: 'eslint-local-rules/fixtures/invalid/local-rules.ts',
    line: 7,
    message:
      'Use Option.fromNullishOr(value) instead of ternary with Option.some/Option.none. See patterns/EFFECT_BEST_PRACTICES.md',
    severity: 'warning'
  },
  ...[
    [1, 'fs/promises'],
    [2, 'node:test'],
    [3, '@effect/platform-node/NodeHttpClient'],
    [4, 'fs/promises'],
    [5, 'node:fs'],
    [7, 'node:fs'],
    [8, 'dynamic module'],
    [9, 'node:fs'],
    [10, 'fs/promises']
  ].map(([line, source]) => ({
    code: 'local(no-node-deps-in-mcp-tools)',
    file: 'eslint-local-rules/fixtures/invalid/lib/mcp/tools/example.ts',
    line,
    message: `MCP tools must be Node-dependency free. Use Effect services/adapters instead of importing ${source}.`,
    severity: 'error'
  })),
  ...[11, 12, 13].map(line => ({
    code: 'local(no-node-deps-in-mcp-tools)',
    file: 'eslint-local-rules/fixtures/invalid/lib/mcp/tools/example.ts',
    line,
    message: 'MCP tools must use Effect HttpClient/service dependencies, not raw fetch().',
    severity: 'error'
  }))
]

const sortDiagnostics = diagnostics =>
  diagnostics.toSorted((left, right) =>
    `${left.file}:${String(left.line)}:${left.code}`.localeCompare(
      `${right.file}:${String(right.line)}:${right.code}`
    )
  )

const normalizeCorpusDiagnostics = diagnostics =>
  diagnostics.map(diagnosticSummary).map(diagnostic => ({
    ...diagnostic,
    file: diagnostic.file.slice(diagnostic.file.indexOf('eslint-local-rules/fixtures/'))
  }))

const rootProbeSource = `
/* oxlint-disable react/react-compiler -- probe only stable rules */
/* eslint-disable react-hooks/rules-of-hooks -- compatibility probe */
import { useState } from 'react'

function helper() {
  useState(0)
}
/* eslint-enable react-hooks/rules-of-hooks */

// SAFETY: Deliberately invalid assertion tests the legacy suppression namespace, never executed.
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- compatibility probe
const mocked = {} as string

export const Example = () => (
  <>
    {/* eslint-disable-next-line @next/next/no-img-element -- compatibility probe */}
    <img src="/fixture.png" alt="" />
  </>
)

const invalid = { disableValidation: true }

void helper

void mocked

void invalid
`

describe('local Oxlint JavaScript rules', () => {
  it('reports every invalid parity case with its expected location, rule, and severity', () => {
    const diagnostics = runOxlint([
      '--config',
      'eslint-local-rules/test.oxlintrc.json',
      '--format',
      'json',
      'eslint-local-rules/fixtures'
    ])

    expect(sortDiagnostics(normalizeCorpusDiagnostics(diagnostics))).toEqual(
      sortDiagnostics(expectedCorpusDiagnostics)
    )
    expect(diagnostics.every(diagnostic => diagnostic.filename.includes('/invalid/'))).toBe(true)
  })

  it('loads the plugin through the root config and honors legacy suppression namespaces', () => {
    const directory = mkdtempSync(path.join(tmpdir(), '10x-oxlint-root-probe-'))
    const filename = path.join(directory, 'root-probe.tsx')

    try {
      writeFileSync(filename, rootProbeSource)

      const diagnostics = runOxlint([
        '--config',
        '.oxlintrc.json',
        '--no-ignore',
        '--format',
        'json',
        filename
      ])

      expect(diagnostics.map(diagnosticSummary)).toEqual([
        {
          code: 'local(no-disable-validation)',
          file: filename.replaceAll('\\', '/'),
          line: 22,
          message:
            'Never use { disableValidation: true }. Fix the data or schema instead. See patterns/EFFECT_BEST_PRACTICES.md',
          severity: 'error'
        }
      ])
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })
})
