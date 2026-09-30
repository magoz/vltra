/**
 * @fileoverview Disallow Effect.catchCause (v4) / Effect.catchAllCause (v3)
 *
 * Effect.catchCause catches both expected errors AND defects (bugs).
 * Use Effect.catch or Effect.mapError instead to only catch expected errors.
 *
 * Detects both v4 name (catchCause) and v3 name (catchAllCause) for safety.
 */

const BANNED_METHODS = ['catchCause', 'catchAllCause']

export const noCatchCause = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow Effect.catchCause - use Effect.catch or mapError instead',
      category: 'Best Practices',
      recommended: true
    },
    messages: {
      noCatchCause:
        'Avoid Effect.{{name}} - it catches defects (bugs) that should crash. Use Effect.catch or Effect.mapError to only catch expected errors. See patterns/EFFECT_BEST_PRACTICES.md'
    },
    schema: []
  },
  create(context) {
    return {
      // Match Effect.catchCause(...) / Effect.catchAllCause(...)
      CallExpression(node) {
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'Effect' &&
          node.callee.property.type === 'Identifier' &&
          BANNED_METHODS.includes(node.callee.property.name)
        ) {
          context.report({
            node,
            messageId: 'noCatchCause',
            data: { name: node.callee.property.name }
          })
        }
      },
      // Match .pipe(Effect.catchCause, ...) / .pipe(Effect.catchAllCause, ...)
      MemberExpression(node) {
        if (
          node.object.type === 'Identifier' &&
          node.object.name === 'Effect' &&
          node.property.type === 'Identifier' &&
          BANNED_METHODS.includes(node.property.name)
        ) {
          if (node.parent.type === 'CallExpression' && node.parent.callee === node) return

          context.report({
            node,
            messageId: 'noCatchCause',
            data: { name: node.property.name }
          })
        }
      }
    }
  }
}
