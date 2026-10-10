// newt's vocabulary, as the UI shows it.

export type ProposalState = 'draft' | 'in review' | 'accepted' | 'merged' | 'discarded'
export type DeltaState = 'pending' | 'approved' | 'rejected'
export type BugState = 'reported' | 'confirmed' | 'resolved' | 'dismissed'
export type ArtifactKind = 'feature' | 'entity' | 'lifecycle' | 'actor' | 'rule' | 'parameter'
export type CheckResult = 'pass' | 'fail' | 'warn'
