/**
 * Splits a SQL script into its statements, on the semicolons that are neither inside
 * a string, a quoted name (`"…"`, `` `…` ``) nor a comment (`-- …`, `/* … *\/`).
 * With `dollarQuotes` (Postgres), not inside a dollar-quoted body either (`$$ … $$`,
 * `$fn$ … $fn$`: a function's). With `backslashEscapes` (MySQL), a `\` in a string
 * escapes the character after it (`'it\'s'`), as it does in Postgres's `E'…'`.
 *
 * A trigger, procedure, function or event (`CREATE [OR REPLACE] [DEFINER = …] TRIGGER …`)
 * may have a compound body, MySQL's `BEGIN … END` or Postgres's `BEGIN ATOMIC … END`,
 * with semicolons of its own: in one, only a `;` outside every `BEGIN`, `CASE`, `IF`,
 * `LOOP`, `REPEAT` and `WHILE` block ends the statement.
 */
export function splitStatements(sql: string, options: { dollarQuotes?: boolean, backslashEscapes?: boolean } = {}): string[] {
  const statements: string[] = []
  let start = 0
  let i = 0
  // The statement's last token (a word in lower case, or the character), `;` at its start.
  let previous = ';'
  // Whether the statement's first words, `CREATE [OR REPLACE] [DEFINER = …]`, are still being read.
  let header = true
  let routine = false
  // The blocks open in a routine's body, innermost last: whether each is a CASE expression.
  const blocks: boolean[] = []

  while (i < sql.length) {
    const char = sql[i]!
    const next = sql[i + 1]
    // A `$` right after a name is part of the name (`price$eur`), not a quote.
    const tag = options.dollarQuotes && char === '$' && !isNamePart(sql[i - 1]) ? /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))?.[0] : undefined

    if (/\s/.test(char)) {
      i++
      continue
    } else if (char === '-' && next === '-') {
      i = endOf(sql, '\n', i + 2)
    } else if (char === '/' && next === '*') {
      i = endOf(sql, '*/', i + 2)
      continue
    } else if (char === "'" || char === '"' || char === '`') {
      const escapeString = char === "'" && (options.backslashEscapes || isEscapeString(sql, i))
      i = endOfQuoted(sql, char, i + 1, escapeString)
    } else if (tag) {
      i = endOf(sql, tag, i + tag.length)
    } else if (char === ';' && blocks.length === 0) {
      const statement = sql.slice(start, i).trim()
      if (statement) statements.push(statement)
      start = ++i
      previous = ';'
      header = true
      routine = false
      continue
    } else if (isNamePart(char)) {
      const from = i
      while (isNamePart(sql[i])) i++
      const word = sql.slice(from, i).toLowerCase()
      if (header) {
        header = previous === ';' ? word === 'create' : HEADER.has(word) || previous === '=' || previous === '@'
        if (!header && previous !== ';' && ROUTINES.has(word)) routine = true
      } else if (routine) {
        follow(blocks, word, previous)
      }
      previous = word
      continue
    } else {
      i++
    }
    previous = char
  }

  const last = sql.slice(start).trim()
  if (last) statements.push(last)
  return statements
}

/** The words that may come between CREATE and TRIGGER, PROCEDURE, FUNCTION or EVENT. */
const HEADER = new Set(['or', 'replace', 'definer', 'current_user', 'constraint'])

const ROUTINES = new Set(['trigger', 'procedure', 'function', 'event'])

/** The blocks that close with `END <their word>`, and open only where a statement starts: `IF(…)` and `REPEAT(…)` are functions too. */
const STATEMENT_BLOCKS = new Set(['if', 'loop', 'repeat', 'while'])

/** The tokens after which a statement starts in a body: `lbl: LOOP` has a label. */
const STATEMENT_STARTS = new Set([';', ':', 'begin', 'atomic', 'then', 'else', 'do', 'loop', 'repeat'])

/** Opens or closes the block `word` opens or closes in a routine's body, after the token `previous`. */
function follow(blocks: boolean[], word: string, previous: string): void {
  // In a CASE expression, THEN and ELSE are followed by an expression, not a statement.
  const startsStatement = STATEMENT_STARTS.has(previous) && !((previous === 'then' || previous === 'else') && blocks.at(-1))
  if (previous === 'end' && (word === 'case' || STATEMENT_BLOCKS.has(word))) return // END IF closes its IF.
  if (word === 'begin') blocks.push(false)
  else if (word === 'case') blocks.push(!startsStatement)
  else if (STATEMENT_BLOCKS.has(word) && startsStatement) blocks.push(false)
  else if (word === 'end') blocks.pop()
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
