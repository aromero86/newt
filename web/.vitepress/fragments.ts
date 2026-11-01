import type { ShikiTransformer } from 'shiki'

const OPEN = 'class __Fragment__ {'
const member = [
  /^@[A-Z]\w*/,
  /^(?:(?:public|private|protected|static|async|readonly|override|get|set)\s+)+[\w#]+/,
  /^[a-z]\w*\s*(?:<[^>]*>)?\((?:[a-z_]\w*\??:[^)]*)?\)(?:\s*:\s*[^={]+)?\s*\{\s*$/,
]
const statement = /^(?:export|import|class|abstract|const|let|function|type|interface|enum|declare)\b/

/** Whether a TypeScript block is a piece of a class body, which the grammar only reads right inside a class. */
export function isClassFragment(code: string): boolean {
  const lines = code.split('\n')
  return lines.some(line => member.some(each => each.test(line))) && !lines.some(line => statement.test(line))
}

/**
 * The manual shows methods without their class, as `@UseCase() async edit(…) { … }`; read alone, TypeScript's grammar
 * misses most of their keywords. Such a block is highlighted inside a class, and the class's lines are dropped again.
 */
export const classFragments: ShikiTransformer = {
  name: 'newt:class-fragments',
  preprocess(code, options) {
    if (!['ts', 'typescript'].includes(options.lang) || !isClassFragment(code)) return
    return `${OPEN}\n${code.replace(/\n$/, '')}\n}`
  },
  tokens(tokens) {
    if (tokens[0]?.map(token => token.content).join('') !== OPEN) return
    return tokens.slice(1, -1)
  },
}
