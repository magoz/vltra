/**
 * @fileoverview Keep MCP tools runtime-portable.
 *
 * MCP tool handlers should stay host-neutral. Put Node-only work in services or boundary adapters,
 * then provide those services at the route/CLI boundary.
 */

import { builtinModules } from 'node:module'

const NODE_BUILTIN_ROOTS = new Set(
  builtinModules.flatMap(source => {
    const [root] = source.replace(/^node:/, '').split('/')

    return root === undefined ? [] : [root]
  })
)

const isMcpToolFile = filename =>
  filename.includes('/lib/mcp/tools/') &&
  !filename.endsWith('.test.ts') &&
  !filename.endsWith('.test.tsx')

const isForbiddenImport = source => {
  if (source.startsWith('node:')) {
    return true
  }

  if (source === '@effect/platform-node' || source.startsWith('@effect/platform-node/')) {
    return true
  }

  const [root] = source.split('/')

  return root !== undefined && NODE_BUILTIN_ROOTS.has(root)
}

export const noNodeDepsInMcpTools = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow Node-only dependencies and raw fetch in MCP tools',
      category: 'Best Practices',
      recommended: true
    },
    messages: {
      noNodeImport:
        'MCP tools must be Node-dependency free. Use Effect services/adapters instead of importing {{source}}.',
      noRawFetch: 'MCP tools must use Effect HttpClient/service dependencies, not raw fetch().'
    },
    schema: []
  },
  create(context) {
    const filename = context.filename ?? context.getFilename()

    if (!isMcpToolFile(filename)) {
      return {}
    }

    const checkSource = (node, value) => {
      const source = String(value)

      if (isForbiddenImport(source)) {
        context.report({ node, messageId: 'noNodeImport', data: { source } })
      }
    }

    const isGlobalFetch = callee =>
      callee.type === 'MemberExpression' &&
      callee.object.type === 'Identifier' &&
      ['globalThis', 'window', 'self'].includes(callee.object.name) &&
      ((callee.computed === false &&
        callee.property.type === 'Identifier' &&
        callee.property.name === 'fetch') ||
        (callee.computed === true &&
          callee.property.type === 'Literal' &&
          callee.property.value === 'fetch'))

    return {
      ImportDeclaration(node) {
        checkSource(node, node.source.value)
      },
      ImportExpression(node) {
        if (node.source.type === 'Literal') {
          checkSource(node, node.source.value)

          return
        }

        context.report({ node, messageId: 'noNodeImport', data: { source: 'dynamic module' } })
      },
      TSImportEqualsDeclaration(node) {
        if (
          node.moduleReference.type === 'TSExternalModuleReference' &&
          node.moduleReference.expression.type === 'Literal'
        ) {
          checkSource(node, node.moduleReference.expression.value)
        }
      },
      ExportNamedDeclaration(node) {
        if (node.source !== null) checkSource(node, node.source.value)
      },
      ExportAllDeclaration(node) {
        checkSource(node, node.source.value)
      },
      CallExpression(node) {
        if (
          (node.callee.type === 'Identifier' && node.callee.name === 'fetch') ||
          isGlobalFetch(node.callee)
        ) {
          context.report({ node, messageId: 'noRawFetch' })

          return
        }

        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'require' &&
          node.arguments[0]?.type === 'Literal'
        ) {
          checkSource(node, node.arguments[0].value)
        }
      }
    }
  }
}
