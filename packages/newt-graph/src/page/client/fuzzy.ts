/**
 * How well `query` matches `text`, its letters in order: higher is better, null for no
 * match. Letters together, at the start of a word (after `.`, `/`, `-`, a space or a
 * capital) and a shorter text score more.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, '')
  if (!q) return 0
  const t = text.toLowerCase()
  const exact = t.indexOf(q)
  if (exact >= 0) return 1000 - exact * 2 - t.length + (isWordStart(text, exact) ? 200 : 0)
  let score = 0
  let at = 0
  let previous = -2
  for (const letter of q) {
    const found = t.indexOf(letter, at)
    if (found < 0) return null
    score += found === previous + 1 ? 12 : 1
    if (isWordStart(text, found)) score += 8
    previous = found
    at = found + 1
  }
  return score - t.length * 0.5
}

function isWordStart(text: string, index: number): boolean {
  if (index === 0) return true
  const before = text[index - 1]!
  const here = text[index]!
  return /[./\-_\s:#@]/.test(before) || (here !== here.toLowerCase() && before === before.toLowerCase())
}
