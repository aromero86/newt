import tseslint from 'typescript-eslint'
import { assertUsesTree, contextBoundaries } from './rules/context-boundaries.js'
import { moduleAnatomy } from './rules/module-anatomy.js'
import { moduleBoundaries } from './rules/module-boundaries.js'
import { queueName } from './rules/queue-name.js'
import { routeBody } from './rules/route-body.js'
import { schemaImports } from './rules/schema-imports.js'
import { useCase } from './rules/use-case.js'

/** The rules of newt that no other plugin has. */
export const plugin = {
  meta: { name: 'newt-eslint' },
  rules: {
    'context-boundaries': contextBoundaries,
    'module-anatomy': moduleAnatomy,
    'module-boundaries': moduleBoundaries,
    'queue-name': queueName,
    'route-body': routeBody,
    'schema-imports': schemaImports,
    'use-case': useCase,
  },
}

/** Where a module's files are: anything under a `modules/<module>/` folder. */
const MODULES = '**/modules/*/**/*.ts'

/**
 * The lint of an application built with newt. A module is a folder in a context's
 * `modules/`; the context is the folder that holds it. What it checks keeps every
 * module the same, whoever writes it:
 *
 * - a module is made of the files every module has, and reaches another only
 *   through its use cases, schema, events, errors and value objects;
 * - a module's schema, which a frontend may import, takes from newt only
 *   `newt/contract`;
 * - a module writes through its repository's `save` or `saveRows`, never in a
 *   transaction of its own, and a handler's queue names who reacts with what to
 *   which event;
 * - every public method of a class extending `Module` in a `*.module.ts` is a use
 *   case, marked `@UseCase` (`newt/use-case`), wherever the module is;
 * - a route passes a body to a use case as it came, never asserting its type
 *   (`newt/route-body`): the use case parses it;
 * - nothing saved is left unawaited;
 * - with `contexts`, each context imports only the ones it says it uses, so they
 *   never form a cycle (`newt/context-boundaries`). `uses` lists every context;
 *   one that names an unknown context or makes a cycle throws here, and a context
 *   folder it does not list uses no other;
 * - with `files`, the globs of the files it lints, it lints only those: every `.ts`
 *   file by default.
 *
 * ```js
 * // eslint.config.js
 * import { newt } from 'newt-eslint'
 * export default newt({ contexts: { folder: 'src/contexts', uses: { auth: [], shop: ['auth'] } } })
 * ```
 *
 * @param {{ files?: string[], contexts?: { folder: string, uses: Record<string, string[]> } }} [options]
 *   the files it lints, the folder of the contexts, and which ones each one uses
 */
export function newt({ files = ['**/*.ts'], contexts } = {}) {
  if (contexts) assertUsesTree(contexts.uses)
  const contextRules = contexts ? [{
    files: files.map(pattern => [pattern, `${contexts.folder.replace(/^\.?\/|\/$/g, '')}/**/*.ts`]),
    rules: { 'newt/context-boundaries': ['error', { folder: contexts.folder, uses: contexts.uses }] },
  }] : []

  return tseslint.config(
    { ignores: ['**/dist/**', '**/node_modules/**'] },
    {
      files,
      languageOptions: { parser: tseslint.parser, parserOptions: { projectService: true } },
      plugins: { newt: plugin, '@typescript-eslint': tseslint.plugin },
      rules: {
        '@typescript-eslint/no-floating-promises': 'error',
        // By the file's name, wherever it is: a module (or its routes) outside modules/, one every context shares, too.
        'newt/use-case': 'error',
        'newt/route-body': 'error',
      },
    },
    ...contextRules,
    {
      // A module's file among those it lints: an inner list is every pattern of it at once.
      files: files.map(pattern => [pattern, MODULES]),
      rules: {
        'newt/module-anatomy': 'error',
        'newt/module-boundaries': 'error',
        'newt/queue-name': 'error',
        'newt/schema-imports': 'error',
        'no-restricted-syntax': ['error', {
          // Called, read or destructured: `store.transaction(…)`, `store['transaction']`, `const { transaction } = store`.
          selector: "MemberExpression[property.name='transaction'], MemberExpression[property.value='transaction'], ObjectPattern > Property[key.name='transaction'], ObjectPattern > Property[key.value='transaction']",
          message: "A module writes through its repository's save (or saveRows), which runs the transaction, checks the write rule and publishes the events: never in a transaction of its own.",
        }],
      },
    },
  )
}
