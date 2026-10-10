import { Route, Routes } from 'react-router'
import { NotFound } from '../../pages/not-found/not-found'
import { Releases } from './releases'

/** The releases zone's own routes, below /releases. */
export function ReleasesRoutes() {
  return (
    <Routes>
      <Route index element={<Releases />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
