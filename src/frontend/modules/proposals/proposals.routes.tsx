import { Route, Routes } from 'react-router'
import { NotFound } from '../../pages/not-found/not-found'
import { Proposal } from './proposal/proposal'
import { ProposalCompare } from './proposal-compare/proposal-compare'
import { ProposalRevision } from './proposal-revision/proposal-revision'
import { ProposalsList } from './proposals-list/proposals-list'

/** The proposals zone's own routes, below /proposals. */
export function ProposalsRoutes() {
  return (
    <Routes>
      <Route index element={<ProposalsList />} />
      <Route path=":key" element={<Proposal />} />
      <Route path=":key/revisions/:number" element={<ProposalRevision />} />
      <Route path=":key/compare" element={<ProposalCompare />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
