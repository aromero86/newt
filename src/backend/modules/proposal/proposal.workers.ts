import type { Proposal_Module } from './proposal.module'

export function registerProposalWorkers(proposals: Proposal_Module) {
  // A revision is published at once; its deltas are extracted after it committed,
  // outside its transaction, since reading the document can take minutes.
  proposals.extractionRequested.subscribe(payload => proposals.extractRevision(payload))
}
