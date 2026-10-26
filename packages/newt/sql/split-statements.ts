/**
 * Splits a SQL script into its statements, on the semicolons that are neither
 * inside a string nor inside a comment. With `dollarQuotes` (Postgres), not inside
 * a dollar-quoted body either (`$$ … $$`, `$fn$ … $fn$`: a function's).
 */
export function splitStatements(sql: string, options: { dollarQuotes?: boolean } = {}): string[] {
  const statements: string[] = []
  let current = ''
  let inString = false
  let inComment = false
  let dollarTag: string | null = null

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i]!

    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        current += dollarTag
        i += dollarTag.length - 1
        dollarTag = null
      } else {
        current += char
      }
      continue
    }

    // A `$` right after a name is part of the name (`price$eur`), not a quote.
    if (options.dollarQuotes && !inString && char === '$' && !/[A-Za-z0-9_$]/.test(sql[i - 1] ?? '')) {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))?.[0]
      if (tag) {
        dollarTag = tag
        current += tag
        i += tag.length - 1
        continue
      }
    }

    if (inComment) {
      current += char
      if (char === '\n') inComment = false
      continue
    }

    if (!inString && char === '-' && sql[i + 1] === '-') {
      inComment = true
      current += char
      continue
    }

    if (char === "'") inString = !inString

    if (char === ';' && !inString) {
      if (current.trim()) statements.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  if (current.trim()) statements.push(current.trim())
  return statements
}
