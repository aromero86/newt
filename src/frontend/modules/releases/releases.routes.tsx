import { Route, Routes } from 'react-router'
import { NotFound } from '../../pages/not-found/not-found'
import { Release } from './release/release'
import { ReleasesList } from './releases-list/releases-list'

/** The releases zone's own routes, below /releases. */
export function ReleasesRoutes() {
  return (
    <Routes>
      <Route index element={<ReleasesList />} />
      <Route path=":name" element={<Release />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
