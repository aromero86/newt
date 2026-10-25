/**
 * Splits a SQL script into its statements, on the semicolons that are neither
 * inside a string nor inside a comment.
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''
  let inString = false
  let inComment = false

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i]!

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
