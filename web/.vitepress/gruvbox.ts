import type { ThemeRegistration } from 'shiki'

/** Gruvbox for the code blocks, light and dark: shiki no longer bundles it, so it is written here. */
function gruvbox(name: string, type: 'light' | 'dark', c: Record<'bg' | 'fg' | 'gray' | 'red' | 'green' | 'yellow' | 'blue' | 'purple' | 'aqua' | 'orange', string>): ThemeRegistration {
  return {
    name,
    type,
    colors: { 'editor.background': c.bg, 'editor.foreground': c.fg },
    tokenColors: [
      { settings: { foreground: c.fg } },
      { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: c.gray, fontStyle: 'italic' } },
      { scope: ['string', 'string.template', 'punctuation.definition.string'], settings: { foreground: c.green } },
      { scope: ['constant.numeric', 'constant.language', 'constant.character'], settings: { foreground: c.purple } },
      { scope: ['keyword', 'storage', 'storage.type', 'storage.modifier', 'keyword.operator.new', 'keyword.control'], settings: { foreground: c.red } },
      { scope: ['keyword.operator', 'punctuation.accessor'], settings: { foreground: c.fg } },
      { scope: ['entity.name.function', 'support.function', 'meta.function-call entity.name.function'], settings: { foreground: c.aqua } },
      { scope: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class', 'entity.other.inherited-class'], settings: { foreground: c.yellow } },
      { scope: ['variable.parameter', 'meta.object-literal.key', 'support.type.property-name', 'entity.other.attribute-name'], settings: { foreground: c.blue } },
      { scope: ['variable.language', 'variable.other.constant', 'meta.decorator', 'entity.name.tag', 'punctuation.decorator'], settings: { foreground: c.orange } },
      { scope: ['markup.heading'], settings: { foreground: c.green, fontStyle: 'bold' } },
      { scope: ['markup.inserted'], settings: { foreground: c.green } },
      { scope: ['markup.deleted'], settings: { foreground: c.red } },
    ],
  }
}

export const gruvboxLight = gruvbox('gruvbox-light', 'light', {
  bg: '#f2e5bc', fg: '#3c3836', gray: '#928374', red: '#9d0006', green: '#79740e', yellow: '#b57614',
  blue: '#076678', purple: '#8f3f71', aqua: '#427b58', orange: '#af3a03',
})
export const gruvboxDark = gruvbox('gruvbox-dark', 'dark', {
  bg: '#282828', fg: '#ebdbb2', gray: '#928374', red: '#fb4934', green: '#b8bb26', yellow: '#fabd2f',
  blue: '#83a598', purple: '#d3869b', aqua: '#8ec07c', orange: '#fe8019',
})
