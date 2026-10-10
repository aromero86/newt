/**
 * The landing exists in two languages, each at its own address: English at the
 * root and Spanish under /es/. Every text is written in both: `Bi<T>`.
 */
export type Lang = 'en' | 'es'

/** A value in both languages. */
export type Bi<T = string> = Record<Lang, T>

/** The address of the landing in a language. */
export function homeOf(lang: Lang) {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/')
  return lang === 'es' ? `${base}es/` : base
}
