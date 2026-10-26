import { Route, Routes } from 'react-router'
import { NotFound } from '../../pages/not-found/not-found'
import { Workspaces } from './workspaces'
import { WorkspacesDetail } from './workspaces-detail/workspaces-detail'

/** The workspaces zone: the list, and one workspace's page. */
export function WorkspacesRoutes() {
  return (
    <Routes>
      <Route index element={<Workspaces />} />
      <Route path=":workspaceId" element={<WorkspacesDetail />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
