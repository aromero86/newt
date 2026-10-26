import { modulePlace, target } from '../paths.js'

/** What a module offers the others: its use cases' module, its contract, what it tells and how it fails. */
const PUBLIC = /^(?:[^/]+\.module|[^/]+\.schema|events\/.+|errors\/.+|value-objects\/.+)$/

/**
 * A module reaches another only through what that one offers: its module (to call
 * its use cases), its schema, its events, its errors and its value objects. Its
 * entity, repository, tables, routes and workers are its own: through them a module
 * would read or write another's data behind its back.
 */
export const moduleBoundaries = {
  meta: {
    type: 'problem',
    docs: { description: "A module imports from another only its module, schema, events, errors and value objects." },
    messages: {
      private: "'{{path}}' is {{module}}'s own: a module reaches another through its use cases (`{{module}}.module.ts`), its schema, its events, its errors and its value objects.",
    },
    schema: [],
  },
  create(context) {
    const place = modulePlace(context.filename, context.cwd)
    if (!place) return {}
    const check = (node, specifier) => {
      if (typeof specifier !== 'string' || !specifier.startsWith('.')) return
      const imported = modulePlace(target(context.filename, specifier), context.cwd)
      if (!imported || (imported.context === place.context && imported.module === place.module)) return
      if (!PUBLIC.test(imported.inside.replace(/\.tsx?$/, ''))) context.report({ node, messageId: 'private', data: { path: specifier, module: imported.module } })
    }
    return {
      ImportDeclaration: node => check(node.source, node.source.value),
      ExportNamedDeclaration: node => node.source && check(node.source, node.source.value),
      ExportAllDeclaration: node => check(node.source, node.source.value),
    }
  },
}
