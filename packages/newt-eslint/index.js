import { isAbsolute, posix } from 'node:path'
import tseslint from 'typescript-eslint'
import { absolute, slashed } from './paths.js'
import { assertUsesTree, contextBoundaries } from './rules/context-boundaries.js'
import { moduleAnatomy } from './rules/module-anatomy.js'
import { moduleBoundaries } from './rules/module-boundaries.js'
import { queueName } from './rules/queue-name.js'
import { routeBody } from './rules/route-body.js'
import { schemaImports } from './rules/schema-imports.js'
import { storageUseCase } from './rules/storage-use-case.js'
import { useCase } from './rules/use-case.js'

/** The rules of newt that no other plugin has. */
export const plugin = {
  meta: { name: '@newt-kit/eslint' },
  rules: {
    'context-boundaries': contextBoundaries,
    'module-anatomy': moduleAnatomy,
    'module-boundaries': moduleBoundaries,
    'queue-name': queueName,
    'route-body': routeBody,
    'schema-imports': schemaImports,
    'storage-use-case': storageUseCase,
    'use-case': useCase,
  },
}

/**
 * The parser of TypeScript that newt's lint reads with, for an app's own configs: typescript-eslint
 * on the TypeScript 6 this package carries, whichever TypeScript the app has.
 */
export const parser = tseslint.parser

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
 *   `@newt-kit/newt/contract`;
 * - a module writes through its repository's `save` or `saveRows`, never in a
 *   transaction of its own, and a handler's queue names who reacts with what to
 *   which event;
 * - what a module does with its files is done by the use cases named after it:
 *   `uploadStart`, `uploadConfirm`, `downloadUrl` (`newt/storage-use-case`);
 * - every public method of a class extending `Module` in a `*.module.ts` is a use
 *   case, marked `@UseCase` (`newt/use-case`), wherever the module is;
 * - a route passes a body to a use case as it came, never asserting its type
 *   (`newt/route-body`): the use case parses it;
 * - nothing saved is left unawaited;
 * - with `contexts`, each context imports only the ones it says it uses, so they
 *   never form a cycle (`newt/context-boundaries`). `uses` lists every context;
 *   one that names an unknown context or makes a cycle throws here, and a context
 *   folder it does not list uses no other. A context's file outside its modules
 *   re-exports only what a module offers (`newt/module-boundaries`);
 * - with `files`, the globs of the files it lints, it lints only those: every `.ts`
 *   file by default.
 *
 * `root` is the folder of the config, which its globs are read from: the folder of
 * the contexts and a `modules/` at the top are read from it too, whatever folder
 * ESLint runs in. Without it, they are read from ESLint's cwd, as they used to.
 *
 * ```js
 * // eslint.config.js
 * import { newt } from '@newt-kit/eslint'
 * export default newt({ root: import.meta.dirname, contexts: { folder: 'src/contexts', uses: { auth: [], shop: ['auth'] } } })
 * ```
 *
 * @param {{ files?: string[], contexts?: { folder: string, uses: Record<string, string[]> }, root?: string }} [options]
 *   the files it lints, the folder of the contexts and which ones each one uses, and the config's folder
 */
export function newt({ files = ['**/*.ts'], contexts, root } = {}) {
  const base = absolute(root ?? process.cwd(), process.cwd())
  if (contexts) assertUsesTree(contexts.uses)
  const folder = contexts && absolute(contexts.folder, base)
  const inside = contexts && posix.relative(base, folder)
  // Without a root, a relative folder is read from ESLint's cwd, as the globs are without a config file.
  const given = root === undefined && !isAbsolute(slashed(contexts?.folder ?? '')) ? inside : folder
  // A glob is read from the config's folder, the root; with one, the rule gets the folder as an absolute path, whatever ESLint's cwd.
  const inContexts = contexts && files.map(pattern => [pattern, `${inside ? `${inside}/` : ''}**/*.ts`])
  const contextRules = contexts ? [{
    files: inContexts,
    rules: { 'newt/context-boundaries': ['error', { folder: given, uses: contexts.uses }] },
  }, {
    // A context's file outside its modules imports what it composes, but its barrels re-export only what a module offers.
    files: inContexts,
    ignores: [MODULES],
    rules: { 'newt/module-boundaries': 'error' },
  }] : []

  return tseslint.config(
    { ignores: ['**/dist/**', '**/node_modules/**'] },
    {
      files,
      languageOptions: { parser: tseslint.parser, parserOptions: { projectService: true } },
      plugins: { newt: plugin, '@typescript-eslint': tseslint.plugin },
      ...root === undefined ? {} : { settings: { newt: { root: base } } },
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
        'newt/storage-use-case': 'error',
        'no-restricted-syntax': ['error', {
          // Called, read or destructured: `store.transaction(…)`, `store['transaction']`, ``store[`transaction`]``, `const { transaction } = store`.
          selector: "MemberExpression[property.name='transaction'], MemberExpression[property.value='transaction'], MemberExpression[property.type='TemplateLiteral'][property.expressions.length=0][property.quasis.0.value.cooked='transaction'], ObjectPattern > Property[key.name='transaction'], ObjectPattern > Property[key.value='transaction']",
          message: "A module writes through its repository's save (or saveRows), which runs the transaction, checks the write rule and publishes the events: never in a transaction of its own.",
        }],
      },
    },
  )
}
