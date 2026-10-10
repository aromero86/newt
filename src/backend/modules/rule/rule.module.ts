import type { Base } from '../../base/base'
import { Module } from '../../core/module/module'
import type { Page } from '../../core/pagination/page'
import type { PageRequest } from '../../core/pagination/page-request'
import { UseCase } from '../../core/unit-of-work/use-case.decorator'
import { InvalidRuleScope } from './errors/invalid-rule-scope'
import { RuleNotFound } from './errors/rule-not-found'
import {
  Rule,
  RuleCreateSchema,
  RuleDraftSchema,
  type RuleCreateDTO,
  type RuleDraftDTO,
  type RuleDTO,
  type RuleFilter,
  type RuleScopeDTO,
  type RuleVersionDTO,
} from './rule'
import type { Rule_Deps } from './rule.deps'
import { Rule_Repository } from './rule.repository'
import { registerRuleRoutes } from './rule.routes'

/**
 * The rules of each workspace and their history. Members read them; creating,
 * replacing and retiring them has no route: the demo data does it now, and
 * proposals will from phase 6.
 */
export class Rule_Module extends Module {

  static async initialize(base: Base, deps: Rule_Deps) {
    const module = new Rule_Module(base, new Rule_Repository(base), deps)
    registerRuleRoutes(base, module)
    return module
  }

  private constructor(base: Base, private readonly repo: Rule_Repository, private readonly deps: Rule_Deps) {
    super('rule', base.transactions)
  }

  /** A page of the workspace's rules, in the order of their numbers. */
  @UseCase('rule.list')
  async list(workspaceId: string, filter: RuleFilter, page: PageRequest): Promise<Page<RuleDTO>> {
    await this.deps.workspaceMember.assertActive(workspaceId)
    const rules = await this.repo.page(workspaceId, filter, page)
    return { ...rules, items: await this.contracts(workspaceId, rules.items) }
  }

  /** One rule by its key (R-7) or its number. */
  @UseCase('rule.get')
  async get(workspaceId: string, key: string): Promise<RuleDTO> {
    await this.deps.workspaceMember.assertActive(workspaceId)
    const [rule] = await this.contracts(workspaceId, [await this.load(workspaceId, key)])
    return rule!
  }

  /** A page of a rule's versions, newest first: what it said, and since when. */
  @UseCase('rule.versions')
  async versions(workspaceId: string, key: string, page: PageRequest): Promise<Page<RuleVersionDTO>> {
    await this.deps.workspaceMember.assertActive(workspaceId)
    return this.repo.versions((await this.load(workspaceId, key)).id, page)
  }

  /** A new rule in an active feature, with the next number of the workspace. */
  @UseCase('rule.create')
  async create(workspaceId: string, input: RuleCreateDTO): Promise<RuleDTO> {
    await this.deps.workspace.assertWritable(workspaceId)
    const { featureId, ...draft } = RuleCreateSchema.parse(input)
    const feature = await this.deps.feature.assertActive(workspaceId, featureId)

    const rule = Rule.create({
      workspaceId,
      number: await this.repo.nextNumber(workspaceId),
      featureId,
      draft: { ...draft, scope: await this.validScope(workspaceId, draft.scope) },
    })
    await this.repo.persist(rule)
    return rule.toContract(feature.name)
  }

  /** A new version replaces the current one; the rule keeps its key. */
  @UseCase('rule.supersede')
  async supersede(workspaceId: string, key: string, input: RuleDraftDTO): Promise<RuleDTO> {
    await this.deps.workspace.assertWritable(workspaceId)
    const draft = RuleDraftSchema.parse(input)
    const rule = await this.load(workspaceId, key)

    rule.supersede({ ...draft, scope: await this.validScope(workspaceId, draft.scope) })
    await this.repo.persist(rule)
    return (await this.contracts(workspaceId, [rule]))[0]!
  }

  /** It no longer holds, but every version stays readable. */
  @UseCase('rule.retire')
  async retire(workspaceId: string, key: string): Promise<RuleDTO> {
    await this.deps.workspace.assertWritable(workspaceId)
    const rule = await this.load(workspaceId, key)
    rule.retire()
    await this.repo.persist(rule)
    return (await this.contracts(workspaceId, [rule]))[0]!
  }

  private load(workspaceId: string, key: string): Promise<Rule> {
    const number = Number.parseInt(key.replace(/^R-/i, ''), 10)
    if (!Number.isInteger(number)) throw new RuleNotFound(key)
    return this.resolve(() => this.repo.find({ workspaceId, number }), () => new RuleNotFound(key))
  }

  private async contracts(workspaceId: string, rules: Rule[]): Promise<RuleDTO[]> {
    const features = await this.deps.feature.find(workspaceId, [...new Set(rules.map(rule => rule.featureId))])
    const names = new Map(features.map(feature => [feature.id, feature.name]))
    return rules.map(rule => rule.toContract(names.get(rule.featureId) ?? ''))
  }

  /**
   * Only active values of the workspace's dimensions, each dimension once. Kept in
   * the order of the dimensions and of their values.
   */
  private async validScope(workspaceId: string, scope: RuleScopeDTO): Promise<RuleScopeDTO> {
    const dimensions = await this.deps.dimension.list(workspaceId)
    const named = new Set<string>()

    for (const { dimensionId, valueIds } of scope) {
      const dimension = dimensions.find(candidate => candidate.id === dimensionId)
      if (!dimension) throw new InvalidRuleScope(`dimension ${dimensionId} is not in this workspace`)
      if (named.has(dimensionId)) throw new InvalidRuleScope(`${dimension.name} appears twice`)
      named.add(dimensionId)
      for (const valueId of valueIds) {
        const value = dimension.values.find(candidate => candidate.id === valueId)
        if (!value || value.retiredAt) throw new InvalidRuleScope(`${valueId} is not an active value of ${dimension.name}`)
      }
    }

    return dimensions.flatMap(dimension => {
      const entry = scope.find(candidate => candidate.dimensionId === dimension.id)
      if (!entry) return []
      const valueIds = dimension.values.filter(value => entry.valueIds.includes(value.id)).map(value => value.id)
      return [{ dimensionId: dimension.id, valueIds }]
    })
  }
}
