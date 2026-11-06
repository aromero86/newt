import { posix } from 'node:path'
import { slashed } from '../paths.js'
import { extendsModule, importedAs } from './use-case.js'

/** Which use case does what with a module's files, and the one call that says it does. */
const PAIRS = [
  { useCase: 'uploadStart', call: 'uploadUrl' },
  { useCase: 'uploadConfirm', call: 'verifyUpload' },
  { useCase: 'downloadUrl', call: 'signedUrl' },
]
const CALLS = new Map(PAIRS.map(pair => [pair.call, pair.useCase]))

const capitalized = name => `${name[0].toUpperCase()}${name.slice(1)}`

/** `uploadStart` or, for a module with several kinds of file, `avatarUploadStart`. */
const isNamed = (method, useCase) => method === useCase || method.endsWith(capitalized(useCase))

/** The pair a method's name says it is, if any. */
const pairOf = method => PAIRS.find(pair => isNamed(method, pair.useCase))

/** What a member is called, when it is written with a name: `files.uploadUrl`, `files['uploadUrl']`. */
function memberName(property, computed) {
  if (!computed) return property.type === 'Identifier' ? property.name : undefined
  return property.type === 'Literal' && typeof property.value === 'string' ? property.value : undefined
}

/**
 * What a module does with its files reads the same in every module: `uploadUrl` is
 * called by `uploadStart`, `verifyUpload` by `uploadConfirm` and `signedUrl` by
 * `downloadUrl`, each by that method of the module itself, never by a helper or a
 * service; and those use cases call them, so an upload is never confirmed unverified.
 * A prefix tells apart the kinds of file of one module (`avatarUploadStart`).
 *
 * It reads names, not types: anything with a member called so counts.
 */
export const storageUseCase = {
  meta: {
    type: 'problem',
    docs: { description: 'What a module does with its files is done by the use cases named after it.' },
    messages: {
      wrongName: "'{{call}}' is called by '{{method}}': it belongs in the use case '{{useCase}}' (or '<kind>{{capitalized}}'), so every module reads the same.",
      outside: "'{{call}}' is called outside a module's method: it belongs in the use case '{{useCase}}' of the module.",
      missing: "'{{method}}' never calls '{{call}}': a use case named so does it itself, or an upload could be confirmed unverified.",
    },
    schema: [],
  },
  create(context) {
    const file = posix.basename(slashed(context.filename))
    if (/\.test\.tsx?$/.test(file)) return {}
    const isModuleFile = file.endsWith('.module.ts')
    let modules
    /** The methods of a module being read, the innermost last: a class inside one starts over. */
    const methods = []

    const seen = (node, call) => {
      const useCase = CALLS.get(call)
      if (!useCase) return
      const method = methods.at(-1)
      if (!method) {
        context.report({ node, messageId: 'outside', data: { call, useCase } })
      } else if (isNamed(method.name, useCase)) {
        method.calls.add(call)
      } else {
        context.report({ node, messageId: 'wrongName', data: { call, method: method.name, useCase, capitalized: capitalized(useCase) } })
      }
    }

    const isModuleMethod = (node) => {
      if (!isModuleFile || node.kind !== 'method' || node.key.type !== 'Identifier') return false
      modules ??= importedAs(context.sourceCode.ast, 'Module')
      return extendsModule(node.parent.parent, modules)
    }

    return {
      MethodDefinition(node) {
        if (isModuleMethod(node)) methods.push({ node, name: node.key.name, calls: new Set() })
      },
      'MethodDefinition:exit'(node) {
        if (methods.at(-1)?.node !== node) return
        const { name, calls } = methods.pop()
        const pair = pairOf(name)
        if (pair && !calls.has(pair.call)) context.report({ node: node.key, messageId: 'missing', data: { method: name, call: pair.call } })
      },
      MemberExpression(node) {
        const name = memberName(node.property, node.computed)
        if (name) seen(node.property, name)
      },
      // `const { uploadUrl } = files`.
      'ObjectPattern > Property'(node) {
        const name = memberName(node.key, node.computed)
        if (name) seen(node.key, name)
      },
    }
  },
}
