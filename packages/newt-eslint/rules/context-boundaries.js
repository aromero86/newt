import { contextOf, importsOf, resolved } from '../paths.js'

/**
 * That `uses` says a tree: every context it names is one of its keys, and none uses
 * itself, directly or through others. Throws, saying which, when it does not.
 */
export function assertUsesTree(uses) {
  for (const [name, used] of Object.entries(uses)) {
    const unknown = used.find(each => !Object.hasOwn(uses, each))
    if (unknown !== undefined) throw new Error(`newt-eslint: the context '${name}' uses '${unknown}', which is not in \`uses\`: list every context, each with the ones it uses ([] for none).`)
  }
  const done = new Set()
  const visit = (name, path) => {
    if (path.includes(name)) throw new Error(`newt-eslint: contexts never use each other in a cycle, and \`uses\` says ${[...path.slice(path.indexOf(name)), name].join(' → ')}.`)
    if (done.has(name)) return
    for (const each of uses[name]) visit(each, [...path, name])
    done.add(name)
  }
  for (const name of Object.keys(uses)) visit(name, [])
}

/**
 * Each context imports only the contexts it says it uses, so they never form a
 * cycle. A context is a folder of `folder`; where an import lands is read from the
 * path it resolves to, however it is written. A context folder that `uses` does not
 * list uses no other.
 */
export const contextBoundaries = {
  meta: {
    type: 'problem',
    docs: { description: 'A context imports only the contexts it says it uses.' },
    messages: {
      other: "'{{path}}' is the context {{other}}'s, and {{context}} uses {{uses}}: contexts use only the ones they say, never in a cycle.",
    },
    schema: [{
      type: 'object',
      properties: {
        folder: { type: 'string' },
        uses: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
      },
      required: ['folder', 'uses'],
      additionalProperties: false,
    }],
  },
  create(context) {
    const [{ folder, uses }] = context.options
    assertUsesTree(uses)
    const known = Object.keys(uses)
    const own = contextOf(context.filename, context.cwd, folder)
    if (!own) return {}
    const allowed = Object.hasOwn(uses, own) ? uses[own] : []
    return importsOf((node, specifier) => {
      const path = resolved(context, specifier)
      const other = path && contextOf(path, context.cwd, folder, known)
      if (other && other !== own && !allowed.includes(other)) {
        context.report({ node, messageId: 'other', data: { path: specifier, other, context: own, uses: allowed.length ? allowed.join(', ') : 'no other context' } })
      }
    })
  },
}
