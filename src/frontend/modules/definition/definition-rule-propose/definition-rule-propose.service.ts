import { DimensionApi, type DimensionDTO } from '@newt/api/dimension'
import type { ProposalDTO } from '@newt/api/proposal'
import type { RuleDTO } from '@newt/api/rule'
import { emptyRuleDraft, toRuleDraft, type RuleDraftValue } from '../../../components/rule-draft-fields'
import { inject } from '../../../core/injector/inject'
import { Store } from '../../../core/store/store'
import { QuickProposalService } from '../../../services/quick-proposal/quick-proposal.service'

type ProposeState = {
  open: boolean
  workspaceId: string
  /** A new rule goes in this feature… */
  featureId: string | undefined
  /** …or this rule gets a new version. */
  rule: RuleDTO | undefined
  value: RuleDraftValue
  dimensions: DimensionDTO[]
  submitting: boolean
}

/** Proposes a new rule for a feature, or a new version of a rule, in a quick proposal. */
export class DefinitionRuleProposeService {

  private readonly quick = inject(QuickProposalService)
  private readonly dimensionApi = inject(DimensionApi)
  private readonly store = new Store<ProposeState>({ open: false, workspaceId: '', featureId: undefined, rule: undefined, value: emptyRuleDraft, dimensions: [], submitting: false })

  readonly open = this.store.select('open')
  readonly rule = this.store.select('rule')
  readonly value = this.store.select('value')
  readonly dimensions = this.store.select('dimensions')
  readonly submitting = this.store.select('submitting')

  /** A new rule for the feature, from scratch. */
  async startNew(workspaceId: string, featureId: string): Promise<void> {
    this.store.patch({ open: true, workspaceId, featureId, rule: undefined, value: emptyRuleDraft })
    this.store.patch({ dimensions: await this.dimensionApi.list(workspaceId) })
  }

  /** A new version of the rule, starting from what it says now. */
  async startChange(workspaceId: string, rule: RuleDTO): Promise<void> {
    const { kind, statement, why, scope, criteria } = rule.current
    const value = { kind, statement, why, criteria, scope: Object.fromEntries(scope.map(entry => [entry.dimensionId, entry.valueIds])) }
    this.store.patch({ open: true, workspaceId, featureId: undefined, rule, value })
    this.store.patch({ dimensions: await this.dimensionApi.list(workspaceId) })
  }

  close(): void {
    this.store.patch({ open: false })
  }

  change(value: RuleDraftValue): void {
    this.store.patch({ value })
  }

  async submit(): Promise<ProposalDTO | undefined> {
    const { workspaceId, featureId, rule, value } = this.store.value
    this.store.patch({ submitting: true })
    const proposal = rule
      ? await this.quick.propose(workspaceId, { kind: 'rule', operation: 'change', targetId: rule.id, after: toRuleDraft(value) })
      : await this.quick.propose(workspaceId, { kind: 'rule', operation: 'create', after: { ...toRuleDraft(value), featureId } })
    this.store.patch({ submitting: false, open: !proposal })
    return proposal
  }
}
