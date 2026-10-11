import type { ValueObject } from '../../../core/value-objects/value-object'
import { ReleaseDocumentSchema, type ReleaseArtifactDTO, type ReleaseChangeDTO, type ReleaseDocumentDTO } from '../release.schema'
import { day, scopeNamer, slug } from './release-specification'

/** What changed, release by release, newest first: by dimension, area and feature, with the proposals behind. */
export type ReleaseChangelog = ReleaseDocumentDTO

/** One section: the changes not released yet (`release` null), or those of a release. */
type ChangelogSection = {
  release: { name: string, description: string, publishedAt: string } | null
  changes: ReleaseChangeDTO[]
}

type ReleaseChangelogInput = {
  workspaceName: string
  sections: ChangelogSection[]
}

type Of<K extends ReleaseArtifactDTO['kind']> = Extract<ReleaseArtifactDTO, { kind: K }>

const VERB = { added: 'New', changed: 'Changed', retired: 'Retired', restored: 'Restored' }

export const ReleaseChangelog = {

  schema: ReleaseDocumentSchema,

  from({ workspaceName, sections }: ReleaseChangelogInput): ReleaseChangelog {
    const lines = [`# ${workspaceName}: changelog`, '']
    for (const { release, changes } of sections) {
      lines.push(release ? `## ${release.name} (${day(release.publishedAt)})` : '## Not released yet', '')
      if (release?.description) lines.push(release.description, '')
      if (changes.length === 0) {
        lines.push('No changes.', '')
        continue
      }
      lines.push(...sectionOf(changes), '')
    }
    return { fileName: `${slug(workspaceName)}-changelog.md`, markdown: `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n` }
  },

} satisfies ValueObject<ReleaseChangelog, ReleaseChangelogInput>

/** The changes of one section, grouped: dimensions, then each area with its features and their rules. */
function sectionOf(changes: ReleaseChangeDTO[]): string[] {
  const now = (change: ReleaseChangeDTO) => (change.after ?? change.before)!
  const dimensions = changes.filter(change => change.kind === 'dimension')
  const scopeOf = scopeNamer(changes.flatMap(change => [change.before, change.after]).filter((each): each is Of<'dimension'> => each?.kind === 'dimension'))

  // Where each change belongs: an area and, below it, a feature.
  const areaOf = (change: ReleaseChangeDTO): string => {
    const artifact = now(change)
    if (artifact.kind === 'feature-area') return artifact.name
    if (artifact.kind === 'feature') return artifact.areaName
    if (artifact.kind === 'rule') return artifact.areaName
    return ''
  }
  const featureOf = (change: ReleaseChangeDTO): string | null => {
    const artifact = now(change)
    return artifact.kind === 'feature' ? artifact.name : artifact.kind === 'rule' ? artifact.featureName : null
  }

  const lines: string[] = []
  if (dimensions.length) {
    lines.push('### Dimensions', '')
    for (const change of dimensions) lines.push(line(change, scopeOf))
    lines.push('')
  }
  const rest = changes.filter(change => change.kind !== 'dimension')
  for (const area of [...new Set(rest.map(areaOf))]) {
    lines.push(`### ${area}`, '')
    const inArea = rest.filter(change => areaOf(change) === area)
    for (const change of inArea.filter(each => featureOf(each) === null)) lines.push(line(change, scopeOf))
    for (const feature of [...new Set(inArea.map(featureOf).filter(each => each !== null))]) {
      lines.push('', `#### ${feature}`, '')
      for (const change of inArea.filter(each => featureOf(each) === feature)) lines.push(line(change, scopeOf))
    }
    lines.push('')
  }
  return lines
}

/** Text that ends like a sentence, so the next one can follow. */
function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`
}

/** One change, said in a line: what it was, what it is, why, and the proposals behind it. */
function line(change: ReleaseChangeDTO, scopeOf: ReturnType<typeof scopeNamer>): string {
  const before = change.before
  const after = change.after!
  const by = change.proposals.length ? ` (${change.proposals.map(proposal => `${proposal.key}: ${proposal.title}`).join('; ')})` : ''
  const verb = `**${VERB[change.change]}**`

  switch (after.kind) {
    case 'dimension': {
      if (change.change !== 'changed' || before?.kind !== 'dimension') return `- ${verb} dimension ${after.name}: ${after.values.filter(value => !value.retired).map(value => value.name).join(', ')}${by}`
      const parts = [
        before.name !== after.name && `renamed from ${before.name}`,
        ...after.values.map(value => {
          const was = before.values.find(each => each.id === value.id)
          if (!was) return `adds ${value.name}`
          if (!was.retired && value.retired) return `retires ${value.name}`
          if (was.retired && !value.retired) return `restores ${value.name}`
          return was.name !== value.name && `renames ${was.name} to ${value.name}`
        }),
      ].filter(Boolean)
      return `- ${verb} dimension ${after.name}: ${parts.join(', ')}${by}`
    }
    case 'feature-area':
    case 'feature': {
      const noun = after.kind === 'feature' ? 'feature' : 'area'
      if (change.change !== 'changed' || !before || before.kind !== after.kind) return `- ${verb} ${noun} ${after.name}${after.description && change.change === 'added' ? `: ${after.description.split('\n')[0]}` : ''}${by}`
      const parts = [
        before.name !== after.name && `renamed from ${before.name}`,
        before.kind === 'feature' && after.kind === 'feature' && before.areaId !== after.areaId && `moved from ${before.areaName} to ${after.areaName}`,
        before.description !== after.description && 'description updated',
      ].filter(Boolean)
      return `- ${verb} ${noun} ${after.name}: ${parts.join(', ')}${by}`
    }
    case 'rule': {
      if (change.change === 'added') return `- ${verb} rule ${after.key} (${after.ruleKind}): ${sentence(after.statement)} Applies ${scopeOf(after.scope)}. Why: ${after.why}${by}`
      if (change.change !== 'changed' || before?.kind !== 'rule') return `- ${verb} rule ${after.key}: ${after.statement}${by}`
      const parts = [
        before.statement !== after.statement ? `now says: ${after.statement} (it said: ${before.statement})` : `still says: ${after.statement}`,
        JSON.stringify(before.scope) !== JSON.stringify(after.scope) && `applies ${scopeOf(after.scope)} (it applied ${scopeOf(before.scope)})`,
        JSON.stringify(before.criteria) !== JSON.stringify(after.criteria) && 'acceptance criteria updated',
        before.ruleKind !== after.ruleKind && `now a ${after.ruleKind} rule`,
      ].filter(Boolean)
      return `- ${verb} rule ${after.key}: ${parts.join('; ')}. Why: ${after.why}${by}`
    }
  }
}
