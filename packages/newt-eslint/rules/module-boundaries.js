import { importsOf, modulePlace, resolved, rootOf } from '../paths.js'

/** What a module offers the others: its use cases' module, its contract, what it tells and how it fails. */
const PUBLIC = /^(?:[^/]+\.module|[^/]+\.schema|events\/.+|errors\/.+|value-objects\/.+)$/

/**
 * A module reaches another only through what that one offers: its module (to call
 * its use cases), its schema, its events, its errors and its value objects. Its
 * entity, repository, tables, routes and workers are its own: through them a module
 * would read or write another's data behind its back. Every way of naming a file is
 * checked, relative or by an alias of the tsconfig's `paths`; the folder of a module
 * (`../product`, its index) is no file it offers.
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
    const root = rootOf(context)
    const place = modulePlace(context.filename, root)
    if (!place) return {}
    return importsOf((node, specifier) => {
      const path = resolved(context, specifier)
      if (!path) return
      const imported = modulePlace(path, root) ?? modulePlace(`${path}/index`, root)
      if (!imported || (imported.context === place.context && imported.module === place.module)) return
      if (!PUBLIC.test(imported.inside)) context.report({ node, messageId: 'private', data: { path: specifier, module: imported.module } })
    })
  },
}
