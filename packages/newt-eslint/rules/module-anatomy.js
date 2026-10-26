import { posix } from 'node:path'
import { modulePlace } from '../paths.js'

/** The folders a module may have, and what each one holds. */
const FOLDERS = {
  events: 'its events, one file each: `<module>-<event>.ts`',
  errors: 'its errors, one file each',
  'value-objects': 'its value objects, one file each',
  services: 'the logic its use cases share, one file each',
}

/**
 * Every module is made of the same files, so whoever opens one (a person or an
 * agent) knows where everything is: `<m>.module.ts`, `<m>.ts`, `<m>.schema.ts`,
 * `<m>.repository.ts`, `<m>.routes.ts`, `<m>.workers.ts`, `<m>.deps.ts`,
 * `<m>-options.ts` (what its context configures it with), its tests, and the
 * folders in `FOLDERS`.
 */
export const moduleAnatomy = {
  meta: {
    type: 'problem',
    docs: { description: 'A module is made of the files every module has, named after it.' },
    messages: {
      file: "'{{file}}' is not a file a module has: its files are {{module}}.module.ts, {{module}}.ts, {{module}}.schema.ts, {{module}}.repository.ts, {{module}}.routes.ts, {{module}}.workers.ts, {{module}}.deps.ts, {{module}}-options.ts and *.test.ts.",
      folder: "'{{folder}}' is not a folder a module has: its folders are {{folders}}.",
      event: "An event's file is named '{{module}}-<event>.ts', not '{{file}}'.",
    },
    schema: [],
  },
  create(context) {
    const place = modulePlace(context.filename, context.cwd)
    if (!place) return {}
    const { module, inside } = place
    const [first, ...rest] = inside.split('/')
    return {
      Program(node) {
        if (rest.length === 0) {
          const files = [...['module', '', 'schema', 'repository', 'routes', 'workers', 'deps'].map(kind => `${module}${kind ? `.${kind}` : ''}.ts`), `${module}-options.ts`]
          if (!files.includes(first) && !first.endsWith('.test.ts')) context.report({ node, messageId: 'file', data: { file: first, module } })
          return
        }
        if (!(first in FOLDERS)) return context.report({ node, messageId: 'folder', data: { folder: first, folders: Object.keys(FOLDERS).join(', ') } })
        const file = posix.basename(inside)
        if (first === 'events' && !file.startsWith(`${module}-`) && !file.endsWith('.test.ts')) context.report({ node, messageId: 'event', data: { module, file } })
      },
    }
  },
}
