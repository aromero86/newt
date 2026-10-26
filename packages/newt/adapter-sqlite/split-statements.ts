/** The words that matter for telling where a statement ends: see `splitStatements`. */
type Token = 'semi' | 'other' | 'explain' | 'create' | 'temp' | 'trigger' | 'end'

/**
 * Where each statement goes after each token, as SQLite's own `sqlite3_complete` reads
 * a script: a `;` ends a statement, except inside a trigger, which ends at `; END ;`.
 * States: 0 start, 1 in a statement, 2 after EXPLAIN, 3 after CREATE (TEMP),
 * 4 in a trigger, 5 after its `;`, 6 after its `; END`.
 */
const NEXT: Record<Token, number>[] = [
  { semi: 0, other: 1, explain: 2, create: 3, temp: 1, trigger: 1, end: 1 },
  { semi: 0, other: 1, explain: 1, create: 1, temp: 1, trigger: 1, end: 1 },
  { semi: 0, other: 2, explain: 1, create: 3, temp: 1, trigger: 1, end: 1 },
  { semi: 0, other: 1, explain: 1, create: 1, temp: 3, trigger: 4, end: 1 },
  { semi: 5, other: 4, explain: 4, create: 4, temp: 4, trigger: 4, end: 4 },
  { semi: 5, other: 4, explain: 4, create: 4, temp: 4, trigger: 4, end: 6 },
  { semi: 0, other: 4, explain: 4, create: 4, temp: 4, trigger: 4, end: 4 },
]

const KEYWORDS: Record<string, Token> = { explain: 'explain', create: 'create', temp: 'temp', temporary: 'temp', trigger: 'trigger', end: 'end' }

const CLOSING: Record<string, string> = { "'": "'", '"': '"', '`': '`', '[': ']' }

/**
 * Splits a script into its statements, each with its text as written: a `;` in a
 * string, a quoted name or a comment ends nothing, nor one in a trigger's body. Only
 * comments, or nothing, is no statement.
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = []
  let state = 0
  let start = 0
  let hasToken = false
  let i = 0
  while (i < sql.length) {
    const char = sql[i]!
    let token: Token | null = null
    const from = i
    if (/\s/.test(char)) {
      i++
    } else if (sql.startsWith('--', i)) {
      const newline = sql.indexOf('\n', i)
      i = newline === -1 ? sql.length : newline + 1
    } else if (sql.startsWith('/*', i)) {
      const close = sql.indexOf('*/', i + 2)
      i = close === -1 ? sql.length : close + 2
    } else if (char in CLOSING) {
      // A doubled quote inside reads as two strings side by side: the same for this.
      const close = sql.indexOf(CLOSING[char]!, i + 1)
      i = close === -1 ? sql.length : close + 1
      token = 'other'
    } else if (char === ';') {
      i++
      token = 'semi'
    } else if (/[\w$\u0080-￿]/.test(char)) {
      while (i < sql.length && /[\w$\u0080-￿]/.test(sql[i]!)) i++
      token = KEYWORDS[sql.slice(from, i).toLowerCase()] ?? 'other'
    } else {
      i++
      token = 'other'
    }
    if (!token) continue

    state = NEXT[state]![token]
    if (token !== 'semi') hasToken = true
    if (state === 0 && token === 'semi') {
      if (hasToken) statements.push(sql.slice(start, i))
      start = i
      hasToken = false
    }
  }
  if (hasToken) statements.push(sql.slice(start))
  return statements
}
