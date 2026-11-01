import { computed, type ComputedRef } from 'vue'
import { useData } from 'vitepress'

/** The landing's languages: English at /, Spanish at /es/. The manual is in English only. */
export type Lang = 'en' | 'es'

export function useLang(): ComputedRef<Lang> {
  const { lang } = useData()
  return computed(() => lang.value.startsWith('es') ? 'es' : 'en')
}

type Over<T> = T extends string | number | boolean ? T : T extends readonly (infer Item)[] ? readonly (Over<Item> | undefined)[] : { [Key in keyof T]?: Over<T[Key]> }

/** The English copy, with the Spanish laid over it when the page is in Spanish: what is not translated (code, names) stays. */
export function useCopy<T>(en: T, es: Over<T>): ComputedRef<T> {
  const lang = useLang()
  return computed(() => lang.value === 'es' ? over(en, es) : en)
}

function over<T>(base: T, layer: unknown): T {
  if (layer === undefined) return base
  if (Array.isArray(base)) return base.map((item, index) => over(item, (layer as unknown[])[index])) as T
  if (base && typeof base === 'object') {
    const out: Record<string, unknown> = { ...base }
    for (const [key, value] of Object.entries(layer as object)) out[key] = over((base as Record<string, unknown>)[key], value)
    return out as T
  }
  return layer as T
}
