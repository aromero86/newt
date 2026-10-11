// The contract comes from the backend modules; the client is ours. Deltas are
// written and reviewed through their proposal.
export { ProposalStatusSchema, type ProposalDTO, type ProposalStatus } from '../../../backend/modules/proposal/proposal.schema'
export type {
  DeltaDimensionState,
  DeltaDTO,
  DeltaFeatureAreaState,
  DeltaFeatureState,
  DeltaInputDTO,
  DeltaKind,
  DeltaOperation,
  DeltaReviewInputDTO,
  DeltaRuleChangeState,
  DeltaRuleCreateState,
  DeltaStatus,
} from '../../../backend/modules/delta/delta.schema'
export * from './proposal.api'
