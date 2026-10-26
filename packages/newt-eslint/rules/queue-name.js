import { posix } from 'node:path'
import { modulePlace, camelCase } from '../paths.js'

/** The calls inside a callback, by the name of the method each one calls. */
function calledMethods(node, found = new Set()) {
  if (!node || typeof node.type !== 'string') return found
  if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.property.type === 'Identifier') found.add(node.callee.property.name)
  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent') continue
    if (Array.isArray(value)) value.forEach(each => calledMethods(each, found))
    else if (value && typeof value.type === 'string') calledMethods(value, found)
  }
  return found
}

const property = (object, name) => object.properties.find(each => each.type === 'Property' && !each.computed && ((each.key.type === 'Identifier' && each.key.name === name) || each.key.value === name))

/**
 * A handler's queue says who reacts with what to which event:
 * `<module>.<use case>.on.<module>.<event>`. Written by hand, it could say another
 * module's or another use case's: this checks it is the module of the workers file,
 * a use case its callback calls, and the event it subscribes to.
 */
export const queueName = {
  meta: {
    type: 'problem',
    docs: { description: "A handler's queue names the module that subscribes, the use case it calls and the event." },
    messages: {
      module: "This queue is '{{module}}.…': the handlers in {{file}} are {{module}}'s, so their queues start with '{{module}}.', not '{{found}}.'.",
      useCase: "This queue says the handler calls '{{useCase}}', but its callback calls no '{{useCase}}': name the use case it calls.",
      event: "This queue ends with '.on.…{{event}}', the event it subscribes to.",
    },
    schema: [],
  },
  create(context) {
    const place = modulePlace(context.filename, context.cwd)
    if (!place || posix.basename(place.inside) !== `${place.module}.workers.ts`) return {}
    const module = camelCase(place.module)
    return {
      CallExpression(node) {
        const { callee, arguments: [callback, options] } = node
        if (callee.type !== 'MemberExpression' || callee.property.name !== 'subscribe' || options?.type !== 'ObjectExpression') return
        const strategy = property(options, 'strategy')?.value
        const queue = property(options, 'queue')?.value
        if (strategy?.value !== 'handler' || queue?.type !== 'Literal' || typeof queue.value !== 'string') return
        const [who, event] = queue.value.split('.on.')
        const [found, useCase] = (who ?? '').split('.')
        if (found !== module) context.report({ node: queue, messageId: 'module', data: { module, found, file: posix.basename(place.inside) } })
        if (useCase && !calledMethods(callback).has(useCase)) context.report({ node: queue, messageId: 'useCase', data: { useCase } })
        const key = callee.object.type === 'MemberExpression' && callee.object.property.type === 'Identifier' ? callee.object.property.name : null
        if (key && event && !event.endsWith(`.${key}`)) context.report({ node: queue, messageId: 'event', data: { event: `.${key}` } })
      },
    }
  },
}
