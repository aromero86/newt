import { Route, Routes } from 'react-router'
import { NotFound } from '../../pages/not-found/not-found'
import { Settings } from './settings'

/** The settings zone's own routes, below /settings. */
export function SettingsRoutes() {
  return (
    <Routes>
      <Route index element={<Settings />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
