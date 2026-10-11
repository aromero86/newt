import type { ValueObject } from '../../../core/value-objects/value-object'
import { ReleaseDocumentSchema, type ReleaseArtifactDTO, type ReleaseDocumentDTO } from '../release.schema'

/** The definition in force as a document: every active artifact, by area and feature. */
export type ReleaseSpecification = ReleaseDocumentDTO

type ReleaseSpecificationInput = {
  workspaceName: string
  /** The release it pictures, or null for the definition in force right now. */
  release: { name: string, publishedAt: string } | null
  artifacts: ReleaseArtifactDTO[]
}

type Of<K extends ReleaseArtifactDTO['kind']> = Extract<ReleaseArtifactDTO, { kind: K }>

export const ReleaseSpecification = {

  schema: ReleaseDocumentSchema,

  from({ workspaceName, release, artifacts }: ReleaseSpecificationInput): ReleaseSpecification {
    const active = artifacts.filter(artifact => !artifact.retired)
    const dimensions = active.filter((artifact): artifact is Of<'dimension'> => artifact.kind === 'dimension')
    const areas = active.filter((artifact): artifact is Of<'feature-area'> => artifact.kind === 'feature-area')
    const features = active.filter((artifact): artifact is Of<'feature'> => artifact.kind === 'feature')
    const rules = active.filter((artifact): artifact is Of<'rule'> => artifact.kind === 'rule')
    const scopeOf = scopeNamer(dimensions)

    const lines = [
      `# ${workspaceName}: specification`,
      '',
      release ? `Release **${release.name}**, published on ${day(release.publishedAt)}.` : `The definition in force on ${day(new Date().toISOString())}, not released yet.`,
      '',
    ]
    if (dimensions.length) {
      lines.push('## Dimensions', '', 'Where each rule applies. A rule that names no value of a dimension applies in all of them.', '')
      for (const dimension of dimensions) lines.push(`- **${dimension.name}**: ${dimension.values.filter(value => !value.retired).map(value => value.name).join(', ') || '—'}`)
      lines.push('')
    }
    for (const area of areas) {
      lines.push(`## ${area.name}`, '')
      if (area.description) lines.push(area.description, '')
      for (const feature of features.filter(each => each.areaId === area.id)) {
        lines.push(`### ${feature.name}`, '')
        if (feature.description) lines.push(feature.description, '')
        for (const rule of rules.filter(each => each.featureId === feature.id)) {
          lines.push(`- **${rule.key}** (${rule.ruleKind}): ${rule.statement}`)
          lines.push(`  - Applies ${scopeOf(rule.scope)}.`)
          lines.push(`  - Why: ${rule.why}`)
          for (const criterion of rule.criteria) lines.push(`  - Given ${criterion.given}, when ${criterion.when}, then ${criterion.then}.`)
        }
        lines.push('')
      }
    }
    return { fileName: `${slug(workspaceName)}-specification${release ? `-${slug(release.name)}` : ''}.md`, markdown: `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n` }
  },

} satisfies ValueObject<ReleaseSpecification, ReleaseSpecificationInput>

/** "in Market: Spain · Surface: Mobile app, Web", or "everywhere". */
export function scopeNamer(dimensions: Of<'dimension'>[]) {
  return (scope: Of<'rule'>['scope']) => {
    if (scope.length === 0) return 'everywhere'
    return `in ${scope.map(({ dimensionId, valueIds }) => {
      const dimension = dimensions.find(each => each.id === dimensionId)
      const values = valueIds.map(id => dimension?.values.find(value => value.id === id)?.name ?? '?')
      return `${dimension?.name ?? '?'}: ${values.join(', ')}`
    }).join(' · ')}`
  }
}

export function day(iso: string): string {
  return iso.slice(0, 10)
}

export function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-|-$/g, '')
}
