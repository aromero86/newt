import { z } from 'zod'
import type { Base } from '../../base/base'
import { Module } from '../../core/module/module'
import type { DeltaDTO, DeltaInputDTO } from '../delta/delta.schema'
import type { DimensionDTO } from '../dimension/dimension.schema'
import type { FeatureAreaDTO } from '../feature-area/feature-area.schema'
import type { FeatureDTO } from '../feature/feature.schema'
import type { RuleDTO, RuleScopeDTO } from '../rule/rule.schema'
import { ExtractionFailed } from './errors/extraction-failed'
import type { Extraction_Deps } from './extraction.deps'
import type { Extraction_Options } from './extraction-options'
import { extractionSystem } from './extraction-prompt'
import { ExtractionAnswerSchema, type ExtractedDelta, type ExtractionDTO, type ExtractionQuestionDTO } from './extraction.schema'
import { AnthropicApiLlm } from './infrastructure/anthropic-api.llm'
import { ClaudeCliLlm } from './infrastructure/claude-cli.llm'
import type { Llm } from './infrastructure/llm'

/** The answer's JSON Schema, in the draft providers accept, without naming it. */
const { $schema: _, ...ANSWER_SCHEMA } = z.toJSONSchema(ExtractionAnswerSchema, { target: 'draft-7' }) as Record<string, unknown>

/** Each workspace language by its name, as the model is told it. */
const LANGUAGES = { en: 'English', es: 'Spanish' }

type Definition = { dimensions: DimensionDTO[], areas: FeatureAreaDTO[], features: FeatureDTO[], rules: RuleDTO[] }

/**
 * Reading a proposal's document with a language model: the deltas it decides,
 * where each comes from, which previous delta each one is, and what it leaves
 * unclear. It writes nothing: the proposal module does, with what it returns.
 */
export class Extraction_Module extends Module {

  static async initialize(base: Base, deps: Extraction_Deps, options: Extraction_Options) {
    const llm = options.provider === 'anthropic-api' ? new AnthropicApiLlm(options.apiKey, options.model) : new ClaudeCliLlm(options.model)
    return new Extraction_Module(base, deps, llm)
  }

  private constructor(base: Base, private readonly deps: Extraction_Deps, private readonly llm: Llm) {
    super('extraction', base.transactions)
  }

  /**
   * The deltas a document decides, given the deltas of its last revision. Not a use
   * case: it waits for a language model, and holds no transaction meanwhile.
   */
  async extract(workspaceId: string, document: string, previous: DeltaDTO[]): Promise<ExtractionDTO> {
    if (!document.trim()) return { deltas: [], questions: [] }
    const definition = await this.definition(workspaceId)
    const [workspace] = await this.deps.workspace.find([workspaceId])
    const prompt = JSON.stringify({ definition: this.described(definition), previousDeltas: previous.map(delta => this.asWritten(delta, definition.dimensions)), document }, null, 1)

    let answer
    try {
      answer = ExtractionAnswerSchema.parse(await this.llm.answer({ system: extractionSystem(LANGUAGES[workspace?.language ?? 'en']), prompt, schema: ANSWER_SCHEMA }))
    } catch (error) {
      throw new ExtractionFailed((error as Error).message)
    }
    return this.translated(answer.deltas, answer.questions, definition, previous, document)
  }

  private async definition(workspaceId: string): Promise<Definition> {
    const [dimensions, areas, features, rules] = await Promise.all([
      this.deps.dimension.list(workspaceId),
      this.deps.featureArea.find(workspaceId, { retired: false }),
      this.deps.feature.find(workspaceId, { retired: false }),
      this.deps.rule.find(workspaceId, { retired: false }),
    ])
    return { dimensions, areas, features, rules }
  }

  /** The definition in force as people read it: by names and keys. */
  private described({ dimensions, areas, features, rules }: Definition) {
    return {
      dimensions: dimensions.map(dimension => ({ name: dimension.name, values: dimension.values.filter(value => !value.retiredAt).map(value => value.name) })),
      areas: areas.map(area => ({ id: area.id, name: area.name, description: area.description })),
      features: features.map(feature => ({
        id: feature.id,
        area: feature.areaId,
        name: feature.name,
        description: feature.description,
        rules: rules.filter(rule => rule.featureId === feature.id).map(rule => ({
          key: rule.key, ruleKind: rule.current.kind, statement: rule.current.statement, why: rule.current.why,
          scope: this.scopeNames(rule.current.scope, dimensions), criteria: rule.current.criteria,
        })),
      })),
    }
  }

  /** A previous delta as the model writes them, so that it can copy it when nothing changed. */
  private asWritten(delta: DeltaDTO, dimensions: DimensionDTO[]): ExtractedDelta & { id: string } {
    const after = (delta.after ?? {}) as Record<string, any>
    const before = (delta.before ?? {}) as Record<string, any>
    const isRule = delta.kind === 'rule'
    return {
      id: delta.id,
      ref: delta.id,
      previousId: null,
      kind: delta.kind as ExtractedDelta['kind'],
      operation: delta.operation as ExtractedDelta['operation'],
      target: delta.operation === 'create' ? null : isRule ? before.key : delta.targetId,
      area: delta.kind === 'feature' ? after.areaId ?? null : null,
      feature: isRule && delta.operation === 'create' ? after.featureId : null,
      name: isRule ? null : after.name ?? null,
      description: isRule ? null : after.description ?? null,
      ruleKind: isRule ? after.kind ?? null : null,
      statement: isRule ? after.statement ?? null : null,
      why: isRule ? after.why ?? null : null,
      scope: isRule && delta.after ? this.scopeNames(after.scope ?? [], dimensions) : null,
      criteria: isRule ? after.criteria ?? null : null,
      sources: delta.sources,
    }
  }

  /** What the model wrote, by ids, with only the sources that are really in the document. */
  private translated(deltas: ExtractedDelta[], questions: ExtractionQuestionDTO[], definition: Definition, previous: DeltaDTO[], document: string): ExtractionDTO {
    const text = normalized(document)
    const refs = new Map(deltas.map(delta => [delta.ref, delta.kind]))
    const result: ExtractionDTO = { deltas: [], questions: [...questions] }

    for (const delta of deltas) {
      const label = delta.statement ?? delta.name ?? delta.target ?? delta.kind
      const sources = delta.sources.filter(source => normalized(source) && text.includes(normalized(source)))
      try {
        if (sources.length === 0) throw new Error('none of what it quotes is in the document')
        const input = this.input(delta, definition, previous, refs)
        result.deltas.push({ previousId: previous.some(each => each.id === delta.previousId) ? delta.previousId : null, ref: delta.ref, input: { ...input, sources } })
      } catch (error) {
        result.questions.push({ question: `"${label}" could not be written as a delta: ${(error as Error).message}.`, sources })
      }
    }
    return result
  }

  private input(delta: ExtractedDelta, { dimensions, features, rules }: Definition, previous: DeltaDTO[], refs: Map<string, string>): DeltaInputDTO {
    const { kind, operation } = delta
    // An existing artifact, one this answer creates (by its ref) or one a previous delta creates.
    const resolve = (value: string | null, of: 'feature-area' | 'feature'): string => {
      if (!value) throw new Error(`it does not say which ${of === 'feature' ? 'feature' : 'area'} it belongs to`)
      if (refs.get(value) === of) return `ref:${value}`
      const created = previous.find(each => each.id === value && each.kind === of && each.operation === 'create')
      if (created) return created.targetId
      return value
    }
    const target = (): string => {
      if (!delta.target) throw new Error(`it does not say which ${kind} it ${operation}s`)
      if (kind !== 'rule') return delta.target
      const rule = rules.find(each => each.key.toLowerCase() === delta.target!.toLowerCase())
      if (!rule) throw new Error(`there is no rule ${delta.target} in force`)
      return rule.id
    }
    const scope = (): RuleScopeDTO => (delta.scope ?? []).map(({ dimension: name, values }) => {
      const dimension = dimensions.find(each => each.name.toLowerCase() === name.toLowerCase())
      if (!dimension) throw new Error(`there is no dimension ${name}`)
      return {
        dimensionId: dimension.id,
        valueIds: values.map(valueName => {
          const value = dimension.values.find(each => !each.retiredAt && each.name.toLowerCase() === valueName.toLowerCase())
          if (!value) throw new Error(`${dimension.name} has no value ${valueName}`)
          return value.id
        }),
      }
    })
    const rule = () => {
      if (!delta.ruleKind || !delta.statement || !delta.why) throw new Error('a rule needs its kind, its statement and why it holds')
      return { kind: delta.ruleKind, statement: delta.statement, why: delta.why, scope: scope(), criteria: delta.criteria ?? [] }
    }

    if (operation === 'retire') return { kind, operation, targetId: target() }
    if (kind === 'feature-area') {
      if (!delta.name) throw new Error('an area needs a name')
      return { kind, operation, ...(operation === 'change' ? { targetId: target() } : {}), after: { name: delta.name, description: delta.description ?? '' } }
    }
    if (kind === 'feature') {
      const current = operation === 'change' ? features.find(each => each.id === target()) : undefined
      const name = delta.name ?? current?.name
      if (!name) throw new Error('a feature needs a name')
      const areaId = delta.area ? resolve(delta.area, 'feature-area') : current?.areaId ?? resolve(null, 'feature-area')
      return { kind, operation, ...(current ? { targetId: current.id } : {}), after: { areaId, name, description: delta.description ?? current?.description ?? '' } }
    }
    if (operation === 'create') return { kind, operation, after: { featureId: resolve(delta.feature, 'feature'), ...rule() } }
    return { kind, operation, targetId: target(), after: rule() }
  }

  private scopeNames(scope: RuleScopeDTO, dimensions: DimensionDTO[]) {
    return scope.map(({ dimensionId, valueIds }) => {
      const dimension = dimensions.find(each => each.id === dimensionId)
      return { dimension: dimension?.name ?? dimensionId, values: valueIds.map(id => dimension?.values.find(value => value.id === id)?.name ?? id) }
    })
  }
}

/** A text as compared with the document: without Markdown marks, extra spaces or curly quotes. */
function normalized(text: string): string {
  return text.replace(/[*_`#>]/g, '').replace(/[“”«»]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim()
}
