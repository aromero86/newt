import { posix } from 'node:path'
import { slashed } from '../paths.js'

/** `Module`, or `core.Module`: the class a module extends. */
function extendsModule(node) {
  const parent = node.superClass
  return parent?.type === 'Identifier' ? parent.name === 'Module'
    : parent?.type === 'MemberExpression' && !parent.computed && parent.property.name === 'Module'
}

/** `@UseCase` or `@UseCase(…)`. */
function isUseCase(decorator) {
  const expression = decorator.expression.type === 'CallExpression' ? decorator.expression.callee : decorator.expression
  return expression.type === 'Identifier' && expression.name === 'UseCase'
}

/** What a member is called, for the message. */
function nameOf(member) {
  return member.key.type === 'Identifier' ? member.key.name : member.key.type === 'Literal' ? String(member.key.value) : '[computed]'
}

/** A member anyone holding the module may call: neither private, protected, `#`, static, nor the constructor or an accessor. */
function isPublicCall(member) {
  if (member.static || member.accessibility === 'private' || member.accessibility === 'protected') return false
  if (member.key.type === 'PrivateIdentifier') return false
  if (member.type === 'MethodDefinition') return member.kind === 'method' && member.value.type !== 'TSEmptyBodyFunctionExpression'
  return member.type === 'PropertyDefinition' && ['ArrowFunctionExpression', 'FunctionExpression'].includes(member.value?.type)
}

/**
 * Every public method of a module is a use case: in a `*.module.ts`, a class that
 * extends `Module` marks each method it offers with `@UseCase`, which runs it as one
 * (the write rule, the retry on a conflict, its span). A method that is not one is
 * `private` (or `protected`). A function in a public field is refused too, since it
 * cannot be decorated: make it a method.
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
    const check = node => {
      if (!extendsModule(node)) return
      const module = node.id?.name ?? 'this module'
      for (const member of node.body.body) {
        if (!isPublicCall(member)) continue
        if (member.type === 'PropertyDefinition') {
          context.report({ node: member.key, messageId: 'field', data: { name: nameOf(member), module } })
        } else if (!(member.decorators ?? []).some(isUseCase)) {
          context.report({ node: member.key, messageId: 'method', data: { name: nameOf(member), module } })
        }
      }
    }
    return { ClassDeclaration: check, ClassExpression: check }
  },
}
