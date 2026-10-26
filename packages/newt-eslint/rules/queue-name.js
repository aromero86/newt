import { posix } from 'node:path'
import { modulePlace, camelCase } from '../paths.js'

/**
 * `<module>.<use case>.on.<module>.<event>`: the framework refuses at startup a
 * handler's queue that does not start with two names and `.on.`; the event is the
 * name of the one it subscribes to, a module's and its own.
 */
const QUEUE = /^([a-z][A-Za-z0-9]*)\.([a-z][A-Za-z0-9]*)\.on\.[^.\s]+\.([^.\s]+)$/

const property = (object, name) => object.properties.find(each => each.type === 'Property' && !each.computed && ((each.key.type === 'Identifier' && each.key.name === name) || each.key.value === name))

/** A value without what only TypeScript sees around it: `'handler' as const` is `'handler'`. */
const unwrap = (node) => node?.type === 'TSAsExpression' || node?.type === 'TSSatisfiesExpression' ? unwrap(node.expression) : node

/** The variable a name is, from the scope it is read in. */
function variableOf(scope, name) {
  for (let each = scope; each; each = each.upper) {
    const found = each.set.get(name)
    if (found) return found
  }
  return null
}

/** Every node under `node`, itself included. */
function* nodes(node) {
  if (!node || typeof node.type !== 'string') return
  yield node
  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent') continue
    if (Array.isArray(value)) for (const each of value) yield* nodes(each)
    else if (value && typeof value.type === 'string') yield* nodes(value)
  }
}

/**
 * A handler's queue says who reacts with what to which event:
 * `<module>.<use case>.on.<module>.<event>`. Written by hand, it could say another
 * module's or another use case's: in every file of a module, this checks it has that
 * shape, that it is the module's, that its callback calls that use case on the
 * module itself, and that it ends with the event it subscribes to.
 */
export const queueName = {
  meta: {
    type: 'problem',
    docs: { description: "A handler's queue names the module that subscribes, the use case it calls and the event." },
    messages: {
      shape: "'{{queue}}' is not a handler's queue: it is '<module>.<use case>.on.<module>.<event>', as 'order.fulfil.on.order.placed'.",
      module: "This queue is '{{module}}.…': the handlers in {{file}} are {{module}}'s, so their queues start with '{{module}}.', not '{{found}}.'.",
      useCase: "This queue says the handler calls {{module}}'s '{{useCase}}', but its callback calls no '{{useCase}}' of {{module}}: name the use case it calls.",
      event: "This queue ends with '.on.…{{event}}', the event it subscribes to.",
    },
    schema: [],
  },
  create(context) {
    const place = modulePlace(context.filename, context.cwd)
    if (!place) return {}
    const module = camelCase(place.module)
    const type = `${module[0].toUpperCase()}${module.slice(1)}_Module`

    /** The names a module goes by without a program to tell its type: its own, and its English plurals (`order`, `orders`; `category`, `categories`; `box`, `boxes`). */
    const names = new Set([module, `${module}s`])
    if (/[^aeiou]y$/.test(module)) names.add(`${module.slice(0, -1)}ies`)
    if (/(s|x|z|ch|sh)$/.test(module)) names.add(`${module}es`)

    /**
     * With the program typescript-eslint builds (as the preset does), what TypeScript
     * says of `object`: whether it is of the module's class; an object it knows no type
     * of (`any`) is not judged, and counts. Without a program, `undefined`.
     */
    const services = context.sourceCode.parserServices
    const checker = services?.program?.getTypeChecker()
    const typed = (object) => {
      if (!checker) return undefined
      const found = checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(object))
      if (['any', 'unknown'].includes(checker.typeToString(found))) return true
      return (found.getSymbol() ?? found.aliasSymbol)?.getName() === type
    }

    /**
     * That `object` is the module: `this` in its own file, or of its type: by what
     * TypeScript says, with a program; without one, by its annotation (`orders:
     * Order_Module`, `m.Order_Module`), or by its name when it has none (`orders`,
     * `this.orders`).
     */
    const isModule = (object) => {
      if (object.type === 'ThisExpression') return true
      const byType = typed(object)
      if (byType !== undefined) return byType
      if (object.type === 'MemberExpression') {
        if (object.computed || object.property.type !== 'Identifier') return false
        const annotation = object.object.type === 'ThisExpression' ? fieldType(object, object.property.name) : undefined
        return annotation ? isType(annotation) : names.has(object.property.name)
      }
      if (object.type !== 'Identifier') return false
      const annotation = variableOf(context.sourceCode.getScope(object), object.name)?.defs[0]?.name.typeAnnotation?.typeAnnotation
      return annotation ? isType(annotation) : names.has(object.name)
    }

    /** That a type annotation names the module's type, also qualified (`m.Order_Module`). */
    const isType = (annotation) => {
      const name = annotation.type === 'TSTypeReference' ? annotation.typeName : null
      return (name?.type === 'Identifier' ? name.name : name?.type === 'TSQualifiedName' ? name.right.name : null) === type
    }

    /** The type `this.<field>` is given in the class around `node`: a property's, or a constructor parameter's (`private orders: Order_Module`). */
    const fieldType = (node, field) => {
      let around = node.parent
      while (around && around.type !== 'ClassBody') around = around.parent
      for (const member of around?.body ?? []) {
        if (member.type === 'PropertyDefinition' && member.key.type === 'Identifier' && member.key.name === field) return member.typeAnnotation?.typeAnnotation
        if (member.type !== 'MethodDefinition' || member.kind !== 'constructor') continue
        for (const param of member.value.params) {
          if (param.type === 'TSParameterProperty' && param.parameter.type === 'Identifier' && param.parameter.name === field) return param.parameter.typeAnnotation?.typeAnnotation
        }
      }
      return undefined
    }

    /** What the callback runs: its body when written there or a function declared in the file, else `null` (`orders.fulfil.bind(orders)`), and nothing is guessed. */
    const body = (callback) => {
      if (callback?.type === 'ArrowFunctionExpression' || callback?.type === 'FunctionExpression') return callback.body
      if (callback?.type !== 'Identifier') return null
      const definition = variableOf(context.sourceCode.getScope(callback), callback.name)?.defs[0]?.node
      return definition?.type === 'FunctionDeclaration' ? definition.body : null
    }

    return {
      CallExpression(node) {
        const { callee, arguments: [callback, options] } = node
        if (callee.type !== 'MemberExpression' || callee.property.name !== 'subscribe' || options?.type !== 'ObjectExpression') return
        const strategy = unwrap(property(options, 'strategy')?.value)
        const queue = unwrap(property(options, 'queue')?.value)
        if (strategy?.value !== 'handler' || queue?.type !== 'Literal' || typeof queue.value !== 'string') return
        const shape = QUEUE.exec(queue.value)
        if (!shape) return context.report({ node: queue, messageId: 'shape', data: { queue: queue.value } })
        const [, found, useCase, event] = shape
        if (found !== module) context.report({ node: queue, messageId: 'module', data: { module, found, file: posix.basename(place.inside) } })
        const runs = body(callback)
        const calls = runs && [...nodes(runs)].some(each => each.type === 'CallExpression' && each.callee.type === 'MemberExpression'
          && !each.callee.computed && each.callee.property.name === useCase && isModule(each.callee.object))
        if (runs && !calls) context.report({ node: queue, messageId: 'useCase', data: { useCase, module } })
        const key = callee.object.type === 'MemberExpression' && callee.object.property.type === 'Identifier' ? callee.object.property.name : null
        if (key && event !== key) context.report({ node: queue, messageId: 'event', data: { event: `.${key}` } })
      },
    }
  },
}
