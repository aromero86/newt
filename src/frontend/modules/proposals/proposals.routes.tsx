import { Route, Routes } from 'react-router'
import { NotFound } from '../../pages/not-found/not-found'
import { Proposals } from './proposals'

/** The proposals zone's own routes, below /proposals. */
export function ProposalsRoutes() {
  return (
    <Routes>
      <Route index element={<Proposals />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
