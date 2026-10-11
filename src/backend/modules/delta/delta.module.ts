import type { Base } from '../../base/base'
import { currentActor } from '../../core/context/current-actor'
import { Module } from '../../core/module/module'
import type { Page } from '../../core/pagination/page'
import type { PageRequest } from '../../core/pagination/page-request'
import { UseCase } from '../../core/unit-of-work/use-case.decorator'
import type { DimensionDTO } from '../dimension/dimension.schema'
import type { RuleDTO } from '../rule/rule.schema'
import {
  Delta,
  DeltaDimensionStateSchema,
  DeltaFeatureAreaStateSchema,
  DeltaFeatureStateSchema,
  DeltaInputSchema,
  DeltaReviewInputSchema,
  DeltaRuleChangeStateSchema,
  DeltaRuleCreateStateSchema,
  type DeltaCounts,
  type DeltaDimensionState,
  type DeltaDTO,
  type DeltaFeatureAreaState,
  type DeltaFeatureState,
  type DeltaInputDTO,
  type DeltaReviewInputDTO,
  type DeltaRuleChangeState,
  type DeltaRuleCreateState,
} from './delta'
import type { Delta_Deps } from './delta.deps'
import { Delta_Repository } from './delta.repository'
import { DeltaBlocked } from './errors/delta-blocked'
import { DeltaNotFound } from './errors/delta-not-found'
import { DeltasNotApproved } from './errors/deltas-not-approved'
import { InvalidDelta } from './errors/invalid-delta'

/** What a delta is, once checked: what it targets and the state before and after. */
type Prepared = { targetId: string, targetLabel: string, before: unknown, after: unknown }

/**
 * The deltas of each proposal: writing them, reviewing them and, when the proposal
 * is merged, applying them all to the definition in force. It does not know about
 * proposal states: the proposal module checks those before calling in.
 */
export class Delta_Module extends Module {

  static async initialize(base: Base, deps: Delta_Deps) {
    return new Delta_Module(base, new Delta_Repository(base), deps)
  }

  private constructor(base: Base, private readonly repo: Delta_Repository, private readonly deps: Delta_Deps) {
    super('delta', base.transactions)
  }

  /** A page of a proposal's deltas, in the order they will be applied. */
  @UseCase('delta.list')
  async list(workspaceId: string, proposalId: string, page: PageRequest): Promise<Page<DeltaDTO>> {
    const deltas = await this.repo.page(proposalId, page)
    return { ...deltas, items: await this.contracts(workspaceId, proposalId, deltas.items) }
  }

  /** How many deltas of each of these proposals are pending, approved and rejected. */
  @UseCase('delta.counts')
  async counts(proposalIds: string[]): Promise<Map<string, DeltaCounts>> {
    return this.repo.counts({ proposalId: proposalIds })
  }

  /** A new delta, checked against the definition in force and the proposal's earlier deltas. */
  @UseCase('delta.add')
  async add(workspaceId: string, proposalId: string, input: DeltaInputDTO): Promise<DeltaDTO> {
    const { kind, operation } = DeltaInputSchema.parse(input)
    const prepared = await this.prepare(workspaceId, proposalId, input)
    const delta = Delta.create({ workspaceId, proposalId, kind, operation, ...prepared })
    await this.repo.persist(delta)
    return (await this.contracts(workspaceId, proposalId, [delta]))[0]!
  }

  /** The same delta, written again: its verdicts go, since they were about the old one. */
  @UseCase('delta.rewrite')
  async rewrite(workspaceId: string, proposalId: string, deltaId: string, input: DeltaInputDTO): Promise<DeltaDTO> {
    const delta = await this.load(proposalId, deltaId)
    const { kind, operation } = DeltaInputSchema.parse(input)
    if (kind !== delta.kind || operation !== delta.operation) throw new InvalidDelta('A delta keeps its kind and operation: remove it and write another')

    const prepared = await this.prepare(workspaceId, proposalId, { ...input, targetId: delta.targetId }, delta)
    delta.rewrite({ targetLabel: prepared.targetLabel, before: prepared.before, after: prepared.after })
    await this.repo.persist(delta)
    return (await this.contracts(workspaceId, proposalId, [delta]))[0]!
  }

  @UseCase('delta.remove')
  async remove(proposalId: string, deltaId: string): Promise<void> {
    const delta = await this.load(proposalId, deltaId)
    delta.remove()
    await this.repo.persist(delta)
  }

  /** The signed-in person's verdict; a rejection says why. */
  @UseCase('delta.review')
  async review(workspaceId: string, proposalId: string, deltaId: string, input: DeltaReviewInputDTO): Promise<DeltaDTO> {
    const review = DeltaReviewInputSchema.parse(input)
    const delta = await this.load(proposalId, deltaId)
    delta.review(currentActor().userId, review.verdict, review.verdict === 'rejected' ? review.reason : '')
    await this.repo.persist(delta)
    return (await this.contracts(workspaceId, proposalId, [delta]))[0]!
  }

  /** Takes back the signed-in person's verdict. */
  @UseCase('delta.withdraw')
  async withdraw(workspaceId: string, proposalId: string, deltaId: string): Promise<DeltaDTO> {
    const delta = await this.load(proposalId, deltaId)
    delta.withdraw(currentActor().userId)
    await this.repo.persist(delta)
    return (await this.contracts(workspaceId, proposalId, [delta]))[0]!
  }

  /** At least one delta, every one approved and none blocked. */
  @UseCase('delta.assertReady')
  async assertReady(workspaceId: string, proposalId: string): Promise<void> {
    const deltas = await this.repo.find({ proposalId: [proposalId] })
    const notApproved = deltas.filter(delta => delta.status !== 'approved').length
    if (deltas.length === 0 || notApproved > 0) throw new DeltasNotApproved(notApproved)
    const blockers = (await Promise.all(deltas.map(delta => this.blockers(workspaceId, delta, deltas)))).flat()
    if (blockers.length) throw new DeltaBlocked(blockers)
  }

  /** Every delta of the proposal into the definition in force, in order, all or none. */
  @UseCase('delta.apply')
  async apply(workspaceId: string, proposalId: string): Promise<void> {
    await this.assertReady(workspaceId, proposalId)
    for (const delta of await this.repo.find({ proposalId: [proposalId] })) await this.applyOne(workspaceId, delta)
  }

  /** A title for a proposal made of this one delta: "Change rule R-7". */
  @UseCase('delta.describe')
  async describe(proposalId: string): Promise<string> {
    const [delta] = await this.repo.find({ proposalId: [proposalId] })
    if (!delta) return 'Change the definition'
    const { targetLabel } = delta.toDTO()
    const verb = { create: 'Create', change: 'Change', retire: 'Retire', restore: 'Restore' }[delta.operation]
    const noun = { 'dimension': 'dimension', 'feature-area': 'area', 'feature': 'feature', 'rule': 'rule' }[delta.kind]
    return `${verb} ${noun} ${targetLabel}`
  }

  private load(proposalId: string, deltaId: string): Promise<Delta> {
    return this.resolve(() => this.repo.find({ proposalId: [proposalId], id: [deltaId] }), () => new DeltaNotFound(deltaId))
  }

  /** Checks a delta and takes the picture of its target as it is now. */
  private async prepare(workspaceId: string, proposalId: string, input: DeltaInputDTO, self?: Delta): Promise<Prepared> {
    const { kind, operation, targetId, after } = DeltaInputSchema.parse(input)
    const others = (await this.repo.find({ proposalId: [proposalId] })).filter(delta => delta.id !== self?.id)
    const target = () => {
      if (!targetId) throw new InvalidDelta(`Say which ${kind} it ${operation}s`)
      if (others.some(delta => delta.targetId === targetId)) throw new InvalidDelta(`This proposal already has a delta on that ${kind}`)
      return targetId
    }
    const newId = self?.targetId ?? Bun.randomUUIDv7()

    switch (`${kind}:${operation}`) {
      case 'dimension:create': {
        const state = withValueIds(DeltaDimensionStateSchema.parse(after))
        return { targetId: newId, targetLabel: state.name, before: null, after: state }
      }
      case 'dimension:change': {
        const before = await this.deps.dimension.get(workspaceId, target())
        const state = withValueIds(DeltaDimensionStateSchema.parse(after))
        const known = new Set(before.values.map(value => value.id))
        if (DeltaDimensionStateSchema.parse(after).values.some(value => value.id && !known.has(value.id))) {
          throw new InvalidDelta(`Some values are not values of ${before.name}`)
        }
        return { targetId: target(), targetLabel: before.name, before, after: state }
      }
      case 'feature-area:create': {
        const state = DeltaFeatureAreaStateSchema.parse(after)
        return { targetId: newId, targetLabel: state.name, before: null, after: state }
      }
      case 'feature-area:change': {
        const before = await this.deps.featureArea.get(workspaceId, target())
        return { targetId: target(), targetLabel: before.name, before, after: DeltaFeatureAreaStateSchema.parse(after) }
      }
      case 'feature-area:retire':
      case 'feature-area:restore': {
        const before = await this.deps.featureArea.get(workspaceId, target())
        return { targetId: target(), targetLabel: before.name, before, after: null }
      }
      case 'feature:create': {
        const state = DeltaFeatureStateSchema.parse(after)
        await this.assertArea(workspaceId, state.areaId, others)
        return { targetId: newId, targetLabel: state.name, before: null, after: state }
      }
      case 'feature:change': {
        const before = await this.deps.feature.get(workspaceId, target())
        const state = DeltaFeatureStateSchema.parse(after)
        await this.assertArea(workspaceId, state.areaId, others)
        return { targetId: target(), targetLabel: before.name, before, after: state }
      }
      case 'feature:retire':
      case 'feature:restore': {
        const before = await this.deps.feature.get(workspaceId, target())
        return { targetId: target(), targetLabel: before.name, before, after: null }
      }
      case 'rule:create': {
        const state = DeltaRuleCreateStateSchema.parse(after)
        await this.assertFeature(workspaceId, state.featureId, others)
        return { targetId: newId, targetLabel: 'new rule', before: null, after: state }
      }
      case 'rule:change': {
        const before = await this.rule(workspaceId, target())
        return { targetId: target(), targetLabel: before.key, before, after: DeltaRuleChangeStateSchema.parse(after) }
      }
      case 'rule:retire': {
        const before = await this.rule(workspaceId, target())
        return { targetId: target(), targetLabel: before.key, before, after: null }
      }
      case 'dimension:retire':
      case 'dimension:restore':
        throw new InvalidDelta('A dimension is not retired as a whole: retire its values with a change')
      default:
        throw new InvalidDelta('A retired rule does not come back: write a new one')
    }
  }

  /** An area in force, or one an earlier delta of the proposal creates. */
  private async assertArea(workspaceId: string, areaId: string, others: Delta[]): Promise<void> {
    if (others.some(delta => delta.kind === 'feature-area' && delta.operation === 'create' && delta.targetId === areaId)) return
    await this.deps.featureArea.get(workspaceId, areaId)
  }

  /** A feature in force, or one an earlier delta of the proposal creates. */
  private async assertFeature(workspaceId: string, featureId: string, others: Delta[]): Promise<void> {
    if (others.some(delta => delta.kind === 'feature' && delta.operation === 'create' && delta.targetId === featureId)) return
    await this.deps.feature.get(workspaceId, featureId)
  }

  private async rule(workspaceId: string, ruleId: string): Promise<RuleDTO> {
    const [rule] = await this.deps.rule.find(workspaceId, { id: [ruleId] })
    if (!rule) throw new InvalidDelta(`Rule ${ruleId} is not in this workspace`)
    return rule
  }

  /**
   * Values a delta retires while rules in force still use them: those rules must
   * change first, in this proposal or another. A rule this proposal retires, or
   * changes to stop naming the value, no longer counts.
   */
  private async blockers(workspaceId: string, delta: Delta, all: Delta[]): Promise<string[]> {
    if (delta.kind !== 'dimension' || delta.operation !== 'change') return []
    const before = delta.before as DimensionDTO
    const after = delta.after as DeltaDimensionState
    const retiring = after.values.filter(value => value.retired && !before.values.find(old => old.id === value.id)?.retiredAt)
    if (retiring.length === 0) return []

    const blockers: string[] = []
    for (const value of retiring) {
      const users = await this.deps.rule.find(workspaceId, { retired: false, usingValues: [value.id!] })
      const stillUsing = users.filter(rule => {
        const own = all.find(other => other.kind === 'rule' && other.targetId === rule.id)
        if (!own) return true
        if (own.operation === 'retire') return false
        return (own.after as DeltaRuleChangeState).scope.some(entry => entry.valueIds.includes(value.id!))
      })
      if (stillUsing.length) blockers.push(`${stillUsing.map(rule => rule.key).join(', ')} still ${stillUsing.length === 1 ? 'uses' : 'use'} ${value.name}`)
    }
    return blockers
  }

  private async applyOne(workspaceId: string, delta: Delta): Promise<void> {
    const id = delta.targetId
    switch (`${delta.kind}:${delta.operation}`) {
      case 'dimension:create': {
        const state = delta.after as DeltaDimensionState
        await this.deps.dimension.create(workspaceId, { name: state.name }, id)
        for (const value of state.values) {
          await this.deps.dimension.addValue(workspaceId, id, { name: value.name }, value.id)
          if (value.retired) await this.deps.dimension.retireValue(workspaceId, id, value.id!)
        }
        return
      }
      case 'dimension:change': {
        const state = delta.after as DeltaDimensionState
        const now = await this.deps.dimension.get(workspaceId, id)
        if (now.name !== state.name) await this.deps.dimension.rename(workspaceId, id, { name: state.name })
        for (const value of state.values) {
          const current = now.values.find(candidate => candidate.id === value.id)
          if (!current) await this.deps.dimension.addValue(workspaceId, id, { name: value.name }, value.id)
          else if (current.name !== value.name) await this.deps.dimension.renameValue(workspaceId, id, value.id!, { name: value.name })
          const retired = current ? current.retiredAt !== null : false
          if (value.retired && !retired) await this.deps.dimension.retireValue(workspaceId, id, value.id!)
          if (!value.retired && retired) await this.deps.dimension.restoreValue(workspaceId, id, value.id!)
        }
        return
      }
      case 'feature-area:create':
        await this.deps.featureArea.create(workspaceId, delta.after as DeltaFeatureAreaState, id)
        return
      case 'feature-area:change':
        await this.deps.featureArea.update(workspaceId, id, delta.after as DeltaFeatureAreaState)
        return
      case 'feature-area:retire':
        await this.deps.featureArea.retire(workspaceId, id)
        return
      case 'feature-area:restore':
        await this.deps.featureArea.restore(workspaceId, id)
        return
      case 'feature:create':
        await this.deps.feature.create(workspaceId, delta.after as DeltaFeatureState, id)
        return
      case 'feature:change': {
        const { areaId, name, description } = delta.after as DeltaFeatureState
        const now = await this.deps.feature.get(workspaceId, id)
        if (now.areaId !== areaId) await this.deps.feature.move(workspaceId, id, { areaId })
        await this.deps.feature.update(workspaceId, id, { name, description })
        return
      }
      case 'feature:retire':
        await this.deps.feature.retire(workspaceId, id)
        return
      case 'feature:restore':
        await this.deps.feature.restore(workspaceId, id)
        return
      case 'rule:create':
        await this.deps.rule.create(workspaceId, delta.after as DeltaRuleCreateState, id)
        return
      case 'rule:change':
        await this.deps.rule.supersede(workspaceId, (await this.rule(workspaceId, id)).key, delta.after as DeltaRuleChangeState)
        return
      case 'rule:retire':
        await this.deps.rule.retire(workspaceId, (await this.rule(workspaceId, id)).key)
        return
    }
  }

  /** The contract: status, reviews with nicks, and what blocks it. */
  private async contracts(workspaceId: string, proposalId: string, deltas: Delta[]): Promise<DeltaDTO[]> {
    if (deltas.length === 0) return []
    const userIds = [...new Set(deltas.flatMap(delta => delta.reviews.map(review => review.userId)))]
    const users = userIds.length ? await this.deps.user.find({ id: userIds }) : []
    const nicks = new Map(users.map(user => [user.id, user.nick]))
    const all = deltas.some(delta => delta.kind === 'dimension') ? await this.repo.find({ proposalId: [proposalId] }) : deltas

    return Promise.all(deltas.map(async delta => {
      const { reviews, ...dto } = delta.toDTO()
      return {
        ...dto,
        status: delta.status,
        reviews: reviews.map(review => ({ ...review, nick: nicks.get(review.userId) ?? '' })),
        blockers: await this.blockers(workspaceId, delta, all),
      }
    }))
  }
}

/** New values get the id they will keep. */
function withValueIds(state: DeltaDimensionState): DeltaDimensionState {
  return { ...state, values: state.values.map(value => ({ ...value, id: value.id ?? Bun.randomUUIDv7() })) }
}
