import type { RuleCriterionDTO } from '../rule/rule.schema'

/** Longest part of a document indexed as one: models read a few hundred words well. */
const SECTION_SIZE = 1500

/** What is searched in a rule: everything it says. */
export function ruleText(rule: { statement: string, why: string, criteria?: RuleCriterionDTO[] }): string {
  return [rule.statement, rule.why, ...(rule.criteria ?? []).map(({ given, when, then }) => `Given ${given}, when ${when}, then ${then}`)].join('\n')
}

/** A Markdown document in parts: by its headings, and long ones by paragraphs. */
export function sectionsOf(document: string): string[] {
  const sections: string[] = []
  for (const block of document.split(/\n(?=#{1,6} )/)) {
    let current = ''
    for (const paragraph of block.split(/\n{2,}/)) {
      if (current && current.length + paragraph.length > SECTION_SIZE) {
        sections.push(current)
        current = ''
      }
      current = current ? `${current}\n\n${paragraph}` : paragraph
    }
    if (current.trim()) sections.push(current.trim())
  }
  return sections
}

/** Words too common to tell anything apart, in Spanish and English. */
const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'are', 'not', 'but', 'can', 'los', 'las', 'del', 'con', 'por', 'para', 'una', 'que', 'sin', 'como', 'mas', 'son'])

/** The words of a text without accents or case, as the index keeps them. */
export function wordsOf(text: string): string[] {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
}

/**
 * The FTS5 query for what someone wrote: any of its words, each by its root, so
 * that "alquiler" finds "alquila" too. Null when no word is long enough.
 */
export function wordsQuery(query: string): { match: string, stems: string[] } | null {
  const stems = [...new Set(wordsOf(query).filter(word => word.length >= 3 && !STOP_WORDS.has(word)).map(word => (word.length > 5 ? word.slice(0, word.length - 2) : word)))]
  return stems.length ? { match: stems.map(stem => `"${stem}"*`).join(' OR '), stems } : null
}

/** About 200 characters of a text around the first of these roots, or its start. */
export function snippetOf(text: string, stems: string[]): string {
  const plain = text.replace(/\s+/g, ' ').trim()
  const words = plain.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  const at = Math.min(...stems.map(stem => words.indexOf(stem)).filter(index => index >= 0), Number.POSITIVE_INFINITY)
  const start = Number.isFinite(at) ? Math.max(0, at - 60) : 0
  return `${start > 0 ? '…' : ''}${plain.slice(start, start + 200)}${start + 200 < plain.length ? '…' : ''}`
}

/** How close two normalized vectors are: 1 means the same. */
export function closeness(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!
  return sum
}
