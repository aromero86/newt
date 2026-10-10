import { dimensions, type Story } from '../../../story'

/** The words the story helpers need that the shared story does not carry. */
export type RolesStoryCopy = {
  /** How a delta's operation is named: `new`, `changed`, `retired` in the visitor's language. */
  ops: Record<'new' | 'changed' | 'retired', string>
  /** A dimension that applies to any value. */
  any: string
}

/**
 * The shared story plus the helpers this section needs: a rule's text by id,
 * and a dimension chip written with its English name and value, shown in the
 * story's language.
 */
export function rolesStory(story: Story, copy: RolesStoryCopy) {
  // By id, the current definition: guestsPayBizum is R-12 *after* PROP-42, not what R-12 says today.
  const { guestsPayBizum: _planned, ...current } = story.rules
  const rulesById = new Map(Object.values(current).map(r => [r.id, r.text]))
  return {
    ...story,
    deltas: story.deltas.map(d => ({ ...d, opLabel: copy.ops[d.op] })),
    rule: (id: string) => rulesById.get(id) ?? id,
    dimension: (name: string, value: string) => {
      const i = dimensions.findIndex(d => d.name === name)
      if (i === -1) return { name, value: value === 'any' ? copy.any : value }
      const j = (dimensions[i].values as readonly string[]).indexOf(value)
      const translated = story.dimensions[i]
      return {
        name: translated.name,
        value: j === -1 ? (value === 'any' ? copy.any : value) : translated.values[j],
      }
    },
  }
}

export type RolesStory = ReturnType<typeof rolesStory>
