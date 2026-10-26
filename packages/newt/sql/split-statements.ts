/**
 * Splits a SQL script into its statements, on the semicolons that are neither inside
 * a string, a quoted name (`"…"`, `` `…` ``) nor a comment (`-- …`, `/* … *\/`).
 * With `dollarQuotes` (Postgres), not inside a dollar-quoted body either (`$$ … $$`,
 * `$fn$ … $fn$`: a function's). With `backslashEscapes` (MySQL), a `\` in a string
 * escapes the character after it (`'it\'s'`), as it does in Postgres's `E'…'`.
 */
export function splitStatements(sql: string, options: { dollarQuotes?: boolean, backslashEscapes?: boolean } = {}): string[] {
  const statements: string[] = []
  let start = 0
  let i = 0

  while (i < sql.length) {
    const char = sql[i]!
    const next = sql[i + 1]
    // A `$` right after a name is part of the name (`price$eur`), not a quote.
    const tag = options.dollarQuotes && char === '$' && !isNamePart(sql[i - 1]) ? /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))?.[0] : undefined

    if (char === '-' && next === '-') {
      i = endOf(sql, '\n', i + 2)
    } else if (char === '/' && next === '*') {
      i = endOf(sql, '*/', i + 2)
    } else if (char === "'" || char === '"' || char === '`') {
      const escapeString = char === "'" && (options.backslashEscapes || isEscapeString(sql, i))
      i = endOfQuoted(sql, char, i + 1, escapeString)
    } else if (tag) {
      i = endOf(sql, tag, i + tag.length)
    } else if (char === ';') {
      const statement = sql.slice(start, i).trim()
      if (statement) statements.push(statement)
      start = ++i
    } else {
      i++
    }
  }

  const last = sql.slice(start).trim()
  if (last) statements.push(last)
  return statements
}

function isNamePart(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_$]/.test(char)
}

/** Whether the string opening at `quote` is a Postgres `E'…'`: an `E` that is a word of its own right before it. */
function isEscapeString(sql: string, quote: number): boolean {
  return (sql[quote - 1] === 'E' || sql[quote - 1] === 'e') && !isNamePart(sql[quote - 2])
}

/** Where what opened before `from` ends: right after `close`, or at the end of the script. */
function endOf(sql: string, close: string, from: number): number {
  const at = sql.indexOf(close, from)
  return at === -1 ? sql.length : at + close.length
}

/** Where a string or a quoted name ends: right after its closing quote; a doubled quote is one inside it. */
function endOfQuoted(sql: string, quote: string, from: number, escapes: boolean): number {
  for (let i = from; i < sql.length; i++) {
    if (escapes && sql[i] === '\\') i++
    else if (sql[i] === quote && sql[i + 1] === quote) i++
    else if (sql[i] === quote) return i + 1
  }
  return sql.length
}
