import type { DimensionDTO } from '@newt/api/dimension'
import { FeatureApi, type FeatureDTO } from '@newt/api/feature'
import { FeatureAreaApi, type FeatureAreaDTO } from '@newt/api/feature-area'
import type { DeltaInputDTO, DeltaKind, DeltaOperation } from '@newt/api/proposal'
import { RuleApi, type RuleCriterionDTO, type RuleDTO, type RuleKind } from '@newt/api/rule'
import { inject } from '../../../../core/injector/inject'
import { ListStore } from '../../../../core/list/list-store'
import { Store } from '../../../../core/store/store'
import { ProposalService } from '../proposal.service'

/** Every delta that can be written by hand, as `kind:operation`. */
export const DELTA_CHOICES = {
  'feature-area:create': 'Create an area',
  'feature-area:change': 'Change an area',
  'feature-area:retire': 'Retire an area',
  'feature-area:restore': 'Restore an area',
  'feature:create': 'Create a feature',
  'feature:change': 'Change a feature',
  'feature:retire': 'Retire a feature',
  'feature:restore': 'Restore a feature',
  'rule:create': 'Create a rule',
  'rule:change': 'Change a rule',
  'rule:retire': 'Retire a rule',
  'dimension:create': 'Create a dimension',
  'dimension:change': 'Change a dimension',
} as const

export type DeltaChoice = keyof typeof DELTA_CHOICES

type DraftState = {
  open: boolean
  choice: DeltaChoice | undefined
  /** The area picked: the target, or where the feature to pick lives. */
  areaId: string | undefined
  /** The feature picked: the target, or where a new rule goes. */
  featureId: string | undefined
  /** Where a changed feature ends up. */
  moveToAreaId: string | undefined
  dimensionId: string | undefined
  ruleKey: string
  rule: RuleDTO | null
  name: string
  description: string
  ruleKind: RuleKind
  statement: string
  why: string
  /** Picked values, by dimension id. */
  scope: Record<string, string[]>
  criteria: RuleCriterionDTO[]
  values: { id?: string, name: string, retired: boolean }[]
  /** New values, one per line. */
  newValues: string
  failure: string | null
  submitting: boolean
}

const EMPTY: Omit<DraftState, 'open'> = {
  choice: undefined,
  areaId: undefined,
  featureId: undefined,
  moveToAreaId: undefined,
  dimensionId: undefined,
  ruleKey: '',
  rule: null,
  name: '',
  description: '',
  ruleKind: 'validation',
  statement: '',
  why: '',
  scope: {},
  criteria: [],
  values: [],
  newValues: '',
  failure: null,
  submitting: false,
}

/** Writes one delta by hand: what it changes, on what, and the state it leaves it in. */
export class ProposalDeltaAddService {

  private readonly proposal = inject(ProposalService)
  private readonly areaApi = inject(FeatureAreaApi)
  private readonly featureApi = inject(FeatureApi)
  private readonly ruleApi = inject(RuleApi)
  private readonly store = new Store<DraftState>({ open: false, ...EMPTY })

  readonly open = this.store.select('open')
  readonly choice = this.store.select('choice')
  readonly areaId = this.store.select('areaId')
  readonly featureId = this.store.select('featureId')
  readonly moveToAreaId = this.store.select('moveToAreaId')
  readonly dimensionId = this.store.select('dimensionId')
  readonly ruleKey = this.store.select('ruleKey')
  readonly rule = this.store.select('rule')
  readonly name = this.store.select('name')
  readonly description = this.store.select('description')
  readonly ruleKind = this.store.select('ruleKind')
  readonly statement = this.store.select('statement')
  readonly why = this.store.select('why')
  readonly scope = this.store.select('scope')
  readonly criteria = this.store.select('criteria')
  readonly values = this.store.select('values')
  readonly newValues = this.store.select('newValues')
  readonly failure = this.store.select('failure')
  readonly submitting = this.store.select('submitting')

  /** Areas to pick, a hundred at a time: the retired ones to restore one. */
  readonly areas = new ListStore<FeatureAreaDTO>(page => this.areaApi.list(this.proposal.workspaceId, page, this.picked === 'feature-area:restore'), 100)
  /** The picked area's features: the retired ones to restore one. */
  readonly features = new ListStore<FeatureDTO>(page => this.featureApi.list(this.proposal.workspaceId, this.store.value.areaId!, page, this.picked === 'feature:restore'), 100)

  private get picked(): DeltaChoice | undefined {
    return this.store.value.choice
  }

  start(): void {
    this.store.patch({ open: true, ...EMPTY })
  }

  close(): void {
    this.store.patch({ open: false })
  }

  set<K extends keyof DraftState>(key: K, value: DraftState[K]): void {
    this.store.patch({ [key]: value, failure: null } as Partial<DraftState>)
  }

  async choose(choice: DeltaChoice): Promise<void> {
    this.store.patch({ ...EMPTY, choice })
    if (!choice.startsWith('dimension') && !choice.startsWith('rule:change') && !choice.startsWith('rule:retire') && choice !== 'feature-area:create') {
      await this.areas.loadFirstPage()
    }
  }

  async pickArea(areaId: string): Promise<void> {
    const area = this.areas.items.peek().find(candidate => candidate.id === areaId)
    this.store.patch({ areaId, featureId: undefined, failure: null })
    if (this.picked === 'feature-area:change' && area) this.store.patch({ name: area.name, description: area.description })
    if (this.picked?.startsWith('feature:') || this.picked === 'rule:create') {
      if (this.picked !== 'feature:create') await this.features.loadFirstPage()
    }
  }

  pickFeature(featureId: string): void {
    const feature = this.features.items.peek().find(candidate => candidate.id === featureId)
    this.store.patch({ featureId, failure: null })
    if (this.picked === 'feature:change' && feature) {
      this.store.patch({ name: feature.name, description: feature.description, moveToAreaId: feature.areaId })
    }
  }

  pickDimension(dimension: DimensionDTO): void {
    this.store.patch({
      dimensionId: dimension.id,
      name: dimension.name,
      values: dimension.values.map(value => ({ id: value.id, name: value.name, retired: value.retiredAt !== null })),
      failure: null,
    })
  }

  /** Finds the rule to change or retire by its key, and starts from what it says. */
  async findRule(): Promise<void> {
    try {
      const rule = await this.ruleApi.one(this.proposal.workspaceId, this.store.value.ruleKey.trim())
      const { kind, statement, why, scope, criteria } = rule.current
      this.store.patch({
        rule,
        ruleKind: kind,
        statement,
        why,
        criteria,
        scope: Object.fromEntries(scope.map(entry => [entry.dimensionId, entry.valueIds])),
        failure: null,
      })
    } catch (error) {
      this.store.patch({ rule: null, failure: (error as Error).message })
    }
  }

  toggleScope(dimensionId: string, valueId: string, on: boolean): void {
    this.store.update(({ scope }) => {
      const picked = (scope[dimensionId] ?? []).filter(id => id !== valueId)
      return { scope: { ...scope, [dimensionId]: on ? [...picked, valueId] : picked } }
    })
  }

  setCriterion(index: number, part: keyof RuleCriterionDTO, value: string): void {
    this.store.update(({ criteria }) => ({ criteria: criteria.map((each, at) => (at === index ? { ...each, [part]: value } : each)) }))
  }

  addCriterion(): void {
    this.store.update(({ criteria }) => ({ criteria: [...criteria, { given: '', when: '', then: '' }] }))
  }

  removeCriterion(index: number): void {
    this.store.update(({ criteria }) => ({ criteria: criteria.filter((_, at) => at !== index) }))
  }

  setValue(index: number, change: Partial<{ name: string, retired: boolean }>): void {
    this.store.update(({ values }) => ({ values: values.map((each, at) => (at === index ? { ...each, ...change } : each)) }))
  }

  async submit(): Promise<void> {
    const delta = this.build()
    if (!delta) return
    this.store.patch({ submitting: true, failure: null })
    try {
      await this.proposal.addDelta(delta)
      this.close()
    } catch (error) {
      this.store.patch({ failure: (error as Error).message })
    } finally {
      this.store.patch({ submitting: false })
    }
  }

  /** The delta as the backend takes it, or null with a failure saying what is missing. */
  private build(): DeltaInputDTO | null {
    const state = this.store.value
    if (!state.choice) return this.missing('Pick what the delta does')
    const [kind, operation] = state.choice.split(':') as [DeltaKind, DeltaOperation]
    const draft = () => ({
      kind: state.ruleKind,
      statement: state.statement,
      why: state.why,
      scope: Object.entries(state.scope).filter(([, ids]) => ids.length).map(([dimensionId, valueIds]) => ({ dimensionId, valueIds })),
      criteria: state.criteria,
    })

    switch (state.choice) {
      case 'feature-area:create':
        return { kind, operation, after: { name: state.name, description: state.description } }
      case 'feature-area:change':
        return state.areaId ? { kind, operation, targetId: state.areaId, after: { name: state.name, description: state.description } } : this.missing('Pick the area')
      case 'feature-area:retire':
      case 'feature-area:restore':
        return state.areaId ? { kind, operation, targetId: state.areaId } : this.missing('Pick the area')
      case 'feature:create':
        return state.areaId ? { kind, operation, after: { areaId: state.areaId, name: state.name, description: state.description } } : this.missing('Pick the area')
      case 'feature:change':
        return state.featureId
          ? { kind, operation, targetId: state.featureId, after: { areaId: state.moveToAreaId ?? state.areaId, name: state.name, description: state.description } }
          : this.missing('Pick the feature')
      case 'feature:retire':
      case 'feature:restore':
        return state.featureId ? { kind, operation, targetId: state.featureId } : this.missing('Pick the feature')
      case 'rule:create':
        return state.featureId ? { kind, operation, after: { featureId: state.featureId, ...draft() } } : this.missing('Pick the feature')
      case 'rule:change':
        return state.rule ? { kind, operation, targetId: state.rule.id, after: draft() } : this.missing('Find the rule by its key')
      case 'rule:retire':
        return state.rule ? { kind, operation, targetId: state.rule.id } : this.missing('Find the rule by its key')
      case 'dimension:create':
        return { kind, operation, after: { name: state.name, values: lines(state.newValues).map(name => ({ name })) } }
      case 'dimension:change':
        return state.dimensionId
          ? { kind, operation, targetId: state.dimensionId, after: { name: state.name, values: [...state.values, ...lines(state.newValues).map(name => ({ name, retired: false }))] } }
          : this.missing('Pick the dimension')
    }
  }

  private missing(failure: string): null {
    this.store.patch({ failure })
    return null
  }
}

function lines(text: string): string[] {
  return text.split('\n').map(line => line.trim()).filter(Boolean)
}
