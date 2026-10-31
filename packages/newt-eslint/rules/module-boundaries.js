import { importsOf, modulePlace, resolved } from '../paths.js'

/** What a module offers the others: its use cases' module, its contract, what it tells and how it fails. */
const PUBLIC = /^(?:[^/]+\.module|[^/]+\.schema|events\/.+|errors\/.+|value-objects\/.+)$/

/**
 * A module reaches another only through what that one offers: its module (to call
 * its use cases), its schema, its events, its errors and its value objects. Its
 * entity, repository, tables, routes and workers are its own: through them a module
 * would read or write another's data behind its back. Every way of naming a file is
 * checked, relative or by an alias of the tsconfig's `paths`; the folder of a module
 * (`../product`, its index) is no file it offers.
 *
 * A file of no module (a context's index, its `modules/index.ts`, a shared file) may
 * import what it needs, as the context's composition does, but re-exports only what
 * a module offers: a barrel would hand the rest to any module that imports it.
 */
export const moduleBoundaries = {
  meta: {
    type: 'problem',
    docs: { description: "A module imports from another only its module, schema, events, errors and value objects." },
    messages: {
      private: "'{{path}}' is {{module}}'s own: a module reaches another through its use cases (`{{module}}.module.ts`), its schema, its events, its errors and its value objects.",
      barrel: "A barrel re-exports '{{path}}', {{module}}'s own file: outside the modules, a file re-exports only what a module offers, its use cases (`{{module}}.module.ts`), its schema, its events, its errors and its value objects.",
    },
    schema: [],
  },
  create(context) {
    const place = modulePlace(context.filename, context.cwd)
    /** The module a path names a file of, when that file is not one it offers and the module is not this file's own. */
    const privateOf = specifier => {
      const path = resolved(context, specifier)
      if (!path) return null
      const imported = modulePlace(path, context.cwd) ?? modulePlace(`${path}/index`, context.cwd)
      if (!imported || PUBLIC.test(imported.inside)) return null
      return place && imported.context === place.context && imported.module === place.module ? null : imported
    }
    if (!place) {
      const reexport = node => {
        if (node.source?.type !== 'Literal' || typeof node.source.value !== 'string') return
        const imported = privateOf(node.source.value)
        if (imported) context.report({ node: node.source, messageId: 'barrel', data: { path: node.source.value, module: imported.module } })
      }
      return { ExportAllDeclaration: reexport, ExportNamedDeclaration: reexport }
    }
    return importsOf((node, specifier) => {
      const imported = privateOf(specifier)
      if (imported) context.report({ node, messageId: 'private', data: { path: specifier, module: imported.module } })
    })
  },
}
