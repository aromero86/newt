import { Route, Routes } from 'react-router'
import { NotFound } from '../../pages/not-found/not-found'
import { Definition } from './definition'

/** The definition zone's own routes, below /definition. */
export function DefinitionRoutes() {
  return (
    <Routes>
      <Route index element={<Definition />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
