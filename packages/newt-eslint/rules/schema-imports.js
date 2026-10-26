import { importsOf, modulePlace } from '../paths.js'

/**
 * A module's schema (`<m>.schema.ts`) is what its clients share with it: a frontend
 * imports it, so it takes from newt only `newt/contract`, what is safe in a browser.
 * `newt/core` and the other entries are the server's: they keep scopes on
 * `AsyncLocalStorage` and reach Bun. Only the schema's own imports are checked, not
 * those of the files it imports.
 */
export const schemaImports = {
  meta: {
    type: 'problem',
    docs: { description: 'A module\'s schema, which a frontend may import, takes from newt only newt/contract.' },
    messages: {
      server: "'{{path}}' is the server's: {{file}} is imported by the frontend, so it takes from newt only 'newt/contract' (value objects and their errors, defineFilter, Page, PageRequest, ErrorBody).",
    },
    schema: [],
  },
  create(context) {
    const place = modulePlace(context.filename, context.cwd)
    if (!place || place.inside !== `${place.module}.schema.ts`) return {}
    return importsOf((node, specifier) => {
      if ((specifier === 'newt' || specifier.startsWith('newt/')) && specifier !== 'newt/contract') {
        context.report({ node, messageId: 'server', data: { path: specifier, file: place.inside } })
      }
    })
  },
}
