import { posix } from 'node:path'
import { slashed } from '../paths.js'

/** Whether an import comes from newt: `newt`, or one of its entry points (`newt/core`). */
function fromNewt(source) {
  return source === 'newt' || source.startsWith('newt/')
}

/** The names newt's `exported` goes by in a file: itself, and `Base` for `import { Module as Base }`. */
function importedAs(program, exported) {
  const names = new Set([exported])
  for (const statement of program.body) {
    if (statement.type !== 'ImportDeclaration' || !fromNewt(statement.source.value)) continue
    for (const specifier of statement.specifiers) {
      const imported = specifier.type === 'ImportSpecifier' ? specifier.imported : undefined
      if (imported && (imported.name ?? imported.value) === exported) names.add(specifier.local.name)
    }
  }
  return names
}

/** `Module`, `core.Module`, or the name `Module` is imported under: the class a module extends. */
function extendsModule(node, modules) {
  const parent = node.superClass
  return parent?.type === 'Identifier' ? modules.has(parent.name)
    : parent?.type === 'MemberExpression' && !parent.computed && parent.property.name === 'Module'
}

/** `@UseCase`, `@core.UseCase` or the name `UseCase` is imported under, called or not. */
function isUseCase(decorator, useCases) {
  const expression = decorator.expression.type === 'CallExpression' ? decorator.expression.callee : decorator.expression
  return expression.type === 'Identifier' ? useCases.has(expression.name)
    : expression.type === 'MemberExpression' && !expression.computed && expression.property.name === 'UseCase'
}

/** What a member is called, for the message. */
function nameOf(member) {
  return member.key.type === 'Identifier' ? member.key.name : member.key.type === 'Literal' ? String(member.key.value) : '[computed]'
}

/**
 * A member anyone holding the module may call: neither private, protected, `#`, static, nor
 * the constructor or an accessor. A field counts when it holds a function, or what a call
 * returns (`this.run.bind(this)`, `wrap(async () => …)`).
 */
function isPublicCall(member) {
  if (member.type !== 'MethodDefinition' && member.type !== 'PropertyDefinition') return false
  if (member.static || member.accessibility === 'private' || member.accessibility === 'protected') return false
  if (member.key.type === 'PrivateIdentifier') return false
  if (member.type === 'MethodDefinition') return member.kind === 'method' && member.value.type !== 'TSEmptyBodyFunctionExpression'
  return ['ArrowFunctionExpression', 'FunctionExpression', 'CallExpression'].includes(member.value?.type)
}

/** The field a constructor parameter declares, when it is a public function: `public readonly place: () => Promise<void>`. */
function publicCallParameter(parameter) {
  if (parameter.type !== 'TSParameterProperty') return undefined
  if (parameter.accessibility === 'private' || parameter.accessibility === 'protected') return undefined
  if (parameter.accessibility !== 'public' && !parameter.readonly) return undefined
  const binding = parameter.parameter.type === 'AssignmentPattern' ? parameter.parameter.left : parameter.parameter
  return binding.type === 'Identifier' && binding.typeAnnotation?.typeAnnotation.type === 'TSFunctionType' ? binding : undefined
}

/**
 * Every public method of a module is a use case: in a `*.module.ts`, a class that
 * extends `Module` marks each method it offers with `@UseCase`, which runs it as one
 * (the write rule, the retry on a conflict, its span). A method that is not one is
 * `private` (or `protected`). A function in a public field, or in a public constructor
 * parameter, is refused too, since it cannot be decorated: make it a method.
 */
export const useCase = {
  meta: {
    type: 'problem',
    docs: { description: 'Every public method of a module is a use case, marked @UseCase.' },
    messages: {
      method: "'{{name}}' is a public method of {{module}} without @UseCase: whatever a module offers is a use case. Mark it @UseCase(), or make it private if only the module calls it.",
      field: "'{{name}}' is a public function of {{module}} in a field, which @UseCase cannot mark: make it a method with @UseCase(), or make it private.",
    },
    schema: [],
  },
  create(context) {
    if (!posix.basename(slashed(context.filename)).endsWith('.module.ts')) return {}
    let modules, useCases
    const check = node => {
      modules ??= importedAs(context.sourceCode.ast, 'Module')
      useCases ??= importedAs(context.sourceCode.ast, 'UseCase')
      if (!extendsModule(node, modules)) return
      const module = node.id?.name ?? 'this module'
      for (const member of node.body.body) {
        if (member.type === 'MethodDefinition' && member.kind === 'constructor') {
          for (const binding of member.value.params.map(publicCallParameter).filter(Boolean)) {
            context.report({ node: binding, messageId: 'field', data: { name: binding.name, module } })
          }
        }
        if (!isPublicCall(member)) continue
        if (member.type === 'PropertyDefinition') {
          context.report({ node: member.key, messageId: 'field', data: { name: nameOf(member), module } })
        } else if (!(member.decorators ?? []).some(decorator => isUseCase(decorator, useCases))) {
          context.report({ node: member.key, messageId: 'method', data: { name: nameOf(member), module } })
        }
      }
    }
    return { ClassDeclaration: check, ClassExpression: check }
  },
}
