/**
 * How two values of a field sort: numbers as numbers, anything else as text, by code
 * point (as SQLite, and Postgres and MySQL with a binary collation, sort UTF-8 text:
 * `B` before `a`); `null` first.
 */
export function compare(a: unknown, b: unknown): number {
  if (a === b) return 0
  if (a === null || a === undefined) return -1
  if (b === null || b === undefined) return 1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  return compareText(String(a), String(b))
}

/**
 * By code point, not by UTF-16 code unit as `<` does: the two differ only past U+FFFF,
 * whose surrogates (U+D800 to U+DFFF) must sort after U+E000 to U+FFFF.
 */
function compareText(a: string, b: string): number {
  const length = Math.min(a.length, b.length)
  for (let i = 0; i < length; i++) {
    const x = a.charCodeAt(i)
    const y = b.charCodeAt(i)
    if (x !== y) return codePointRank(x) - codePointRank(y)
  }
  return a.length - b.length
}

function codePointRank(unit: number): number {
  if (unit < 0xd800) return unit
  return unit >= 0xe000 ? unit - 0x800 : unit + 0x2000
}
