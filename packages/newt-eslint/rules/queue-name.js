import { posix } from 'node:path'
import { modulePlace, camelCase } from '../paths.js'

/**
 * `<module>.<use case>.on.<module>.<event>`: the framework refuses at startup a
 * handler's queue that does not start with two names and `.on.`; the event is the
 * name of the one it subscribes to, a module's and its own.
 */
const QUEUE = /^([a-z][A-Za-z0-9]*)\.([a-z][A-Za-z0-9]*)\.on\.([^.\s]+\.([^.\s]+))$/

const property = (object, name) => object.properties.find(each => each.type === 'Property' && !each.computed && ((each.key.type === 'Identifier' && each.key.name === name) || each.key.value === name))

const TYPED = new Set(['TSAsExpression', 'TSSatisfiesExpression', 'TSTypeAssertion', 'TSNonNullExpression'])

/** A value without what only TypeScript sees around it: `'handler' as const`, `<const>'handler'` and `'handler'!` are `'handler'`. */
const unwrap = (node) => TYPED.has(node?.type) ? unwrap(node.expression) : node

/** The string a value is written as: a string, or a template with nothing in it (`` `order.fulfil.on.order.placed` ``); else `undefined`. */
function text(node) {
  const value = unwrap(node)
  if (value?.type === 'Literal') return typeof value.value === 'string' ? value.value : undefined
  return value?.type === 'TemplateLiteral' && value.expressions.length === 0 ? value.quasis[0].value.cooked : undefined
}

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
      event: "This queue ends with '.on.{{event}}', the event it subscribes to.",
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
     * The name of the event an emitter tells, by what TypeScript says of where it comes
     * from: the `eventName` of its event class (`eventsOf(bus, { placed: Order_Placed })`),
     * or the name of a schedule (`schedules.define('order.nightly', …)`). `undefined`
     * when it cannot tell.
     */
    const eventName = (emitter) => {
      const node = services.esTreeNodeToTSNodeMap.get(emitter)
      const symbol = checker.getSymbolAtLocation(node.name ?? node)
      for (const declaration of symbol?.declarations ?? []) {
        for (const value of [declaration.initializer, ...assigned(declaration.parent, symbol)]) {
          const name = value && (literal(checker.getTypeAtLocation(value).getProperty('eventName')) ?? scheduled(value))
          if (name) return name
        }
      }
      return undefined
    }

    /** The string a symbol's type is, when it is one (`static readonly eventName = 'order.placed'`). */
    const literal = (symbol) => {
      const found = symbol && checker.getTypeOfSymbol(symbol)
      return found?.isStringLiteral() ? found.value : undefined
    }

    /** The name a schedule is defined with (`base.schedules.define('order.nightly', '0 3 * * *')`). */
    const scheduled = (call) => call.arguments?.length && call.expression.name?.text === 'define'
      ? (found => found.isStringLiteral() ? found.value : undefined)(checker.getTypeAtLocation(call.arguments[0]))
      : undefined

    /** What is assigned to `symbol` under `node` (`this.nightly = …` in a constructor). */
    const assigned = (node, symbol) => {
      const found = []
      const visit = (each) => {
        if (each.operatorToken && each.right && checker.getSymbolAtLocation(each.left.name ?? each.left) === symbol) found.push(each.right)
        each.forEachChild(visit)
      }
      node?.forEachChild(visit)
      return found
    }

    /** The class `this` is at `node`, through arrow functions; `null` in a function of its own. */
    const classOf = (node) => {
      for (let around = node.parent; around; around = around.parent) {
        if (around.type === 'ClassBody') return around.parent
        if (around.type === 'FunctionDeclaration' || (around.type === 'FunctionExpression' && around.parent.type !== 'MethodDefinition')) return null
      }
      return null
    }

    /**
     * That `object` is the module: of its type, by what TypeScript says, with a
     * program; without one, `this` in its own file or in a class of its name, or by
     * its annotation (`orders: Order_Module`, `m.Order_Module`), or by its name when
     * it has none (`orders`, `this.orders`).
     */
    const isModule = (object) => {
      const byType = typed(object)
      if (byType !== undefined) return byType
      if (object.type === 'ThisExpression') return place.inside.endsWith('.module.ts') || classOf(object)?.id?.name === type
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
        const queue = unwrap(property(options, 'queue')?.value)
        const name = text(queue)
        if (text(property(options, 'strategy')?.value) !== 'handler' || name === undefined) return
        const shape = QUEUE.exec(name)
        if (!shape) return context.report({ node: queue, messageId: 'shape', data: { queue: name } })
        const [, found, useCase, event, last] = shape
        if (found !== module) context.report({ node: queue, messageId: 'module', data: { module, found, file: posix.basename(place.inside) } })
        const runs = body(callback)
        const calls = runs && [...nodes(runs)].some(each => each.type === 'CallExpression' && each.callee.type === 'MemberExpression'
          && !each.callee.computed && each.callee.property.name === useCase && isModule(each.callee.object))
        if (runs && !calls) context.report({ node: queue, messageId: 'useCase', data: { useCase, module } })
        if (checker) {
          const told = eventName(callee.object)
          if (told && event !== told) context.report({ node: queue, messageId: 'event', data: { event: told } })
          return
        }
        // Without a program, only the key it is read from in `events` (`eventsOf`'s) says the event.
        const emitter = callee.object
        const key = emitter.type === 'MemberExpression' && !emitter.computed && emitter.property.type === 'Identifier'
          && emitter.object.type === 'MemberExpression' && !emitter.object.computed && emitter.object.property.name === 'events' ? emitter.property.name : null
        if (key && last !== key) context.report({ node: queue, messageId: 'event', data: { event: `….${key}` } })
      },
    }
  },
}
