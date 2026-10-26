import tseslint from 'typescript-eslint'
import { moduleAnatomy } from './rules/module-anatomy.js'
import { moduleBoundaries } from './rules/module-boundaries.js'
import { queueName } from './rules/queue-name.js'

/** The rules of newt that no other plugin has. */
export const plugin = {
  meta: { name: 'newt-eslint' },
  rules: {
    'module-anatomy': moduleAnatomy,
    'module-boundaries': moduleBoundaries,
    'queue-name': queueName,
  },
}

/** Where a module's files are: anything under a `modules/<module>/` folder. */
const MODULES = ['**/modules/*/**/*.ts']

/**
 * The lint of an application built with newt. A module is a folder in a context's
 * `modules/`; the context is the folder that holds it. What it checks keeps every
 * module the same, whoever writes it:
 *
 * - a module is made of the files every module has, and reaches another only
 *   through its use cases, schema, events, errors and value objects;
 * - a module writes through its repository's `save` or `saveRows`, never in a
 *   transaction of its own, and a handler's queue names who reacts with what to
 *   which event;
 * - nothing saved is left unawaited;
 * - with `contexts`, each context imports only the ones it says it uses, so they
 *   never form a cycle.
 *
 * ```js
 * // eslint.config.js
 * import { newt } from 'newt-eslint'
 * export default newt({ contexts: { folder: 'src/contexts', uses: { auth: [], shop: ['auth'] } } })
 * ```
 *
 * @param {{ contexts?: { folder: string, uses: Record<string, string[]> } }} [options]
 *   the folder of the contexts, and which ones each one uses
 */
export function newt({ contexts } = {}) {
  const contextRules = contexts ? Object.entries(contexts.uses).map(([name, uses]) => {
    const others = Object.keys(contexts.uses).filter(other => other !== name && !uses.includes(other))
    return {
      files: [`${contexts.folder}/${name}/**/*.ts`],
      rules: {
        'no-restricted-imports': ['error', { patterns: others.length ? [{
          regex: `^(\\.\\./)+(${others.join('|')})(/|$)`,
          message: `${name} uses ${uses.length ? uses.join(', ') : 'no other context'}: contexts use only the ones they say, never in a cycle.`,
        }] : [] }],
      },
    }
  }) : []

  return tseslint.config(
    { ignores: ['**/dist/**', '**/node_modules/**'] },
    {
      files: ['**/*.ts'],
      languageOptions: { parser: tseslint.parser, parserOptions: { projectService: true } },
      plugins: { newt: plugin, '@typescript-eslint': tseslint.plugin },
      rules: { '@typescript-eslint/no-floating-promises': 'error' },
    },
    ...contextRules,
    {
      files: MODULES,
      rules: {
        'newt/module-anatomy': 'error',
        'newt/module-boundaries': 'error',
        'newt/queue-name': 'error',
        'no-restricted-syntax': ['error', {
          selector: "CallExpression[callee.property.name='transaction']",
          message: "A module writes through its repository's save (or saveRows), which runs the transaction, checks the write rule and publishes the events: never in a transaction of its own.",
        }],
      },
    },
  )
}
