/** Every name a module goes by, from its folder's (`price-change`), as newt's lint and conventions want them. */
export type ModuleNames = {
  /** `price-change`: the folder and the files. */
  folder: string
  /** `priceChange`: the module's name, its use cases' and events' prefix. */
  module: string
  /** `PriceChange`: the entity. */
  entity: string
  /** `price_change`: the table. */
  table: string
  /** `price change`: in a sentence. */
  words: string
  /** `priceChanges`: a variable holding the module. */
  plural: string
  /** `price-changes`: its routes' path. */
  path: string
}

/** A folder's name in kebab case: lower-case words of letters and digits, joined by hyphens. */
export const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

export function moduleNames(folder: string): ModuleNames {
  const words = folder.split('-')
  const module = words.map((word, i) => i === 0 ? word : word[0]!.toUpperCase() + word.slice(1)).join('')
  const last = words.at(-1)!
  const pluralLast = /(s|x|z|ch|sh)$/.test(last) ? `${last}es` : /[^aeiou]y$/.test(last) ? `${last.slice(0, -1)}ies` : `${last}s`
  const pluralWords = [...words.slice(0, -1), pluralLast]
  return {
    folder,
    module,
    entity: module[0]!.toUpperCase() + module.slice(1),
    table: words.join('_'),
    words: words.join(' '),
    plural: pluralWords.map((word, i) => i === 0 ? word : word[0]!.toUpperCase() + word.slice(1)).join(''),
    path: pluralWords.join('-'),
  }
}
