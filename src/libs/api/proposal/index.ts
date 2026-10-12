// The contract comes from the backend modules; the client is ours. Deltas are
// written and reviewed through their proposal.
export { ProposalStatusSchema, type ProposalApproveAllDTO, type ProposalDTO, type ProposalExtractionDTO, type ProposalExtractionState, type ProposalRevisionDTO, type ProposalStatus } from '../../../backend/modules/proposal/proposal.schema'
export type {
  DeltaChange,
  DeltaComparisonDTO,
  DeltaContentDTO,
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
  DeltaSnapshotDTO,
  DeltaStatus,
  DeltaView,
} from '../../../backend/modules/delta/delta.schema'
export * from './proposal.api'
