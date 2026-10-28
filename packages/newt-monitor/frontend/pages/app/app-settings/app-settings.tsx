import { Route, Routes, useLocation } from 'react-router'
import { HistoryIcon, PlugZapIcon, SettingsIcon } from 'lucide-react'
import { SideNav, SideNavItem } from 'newt-react-ui/side-nav'
import { SidebarLayout } from 'newt-react-ui/sidebar-layout'
import type { AppDTO } from '../../../api/app'
import { NotFound } from '../../not-found/not-found'
import { AppVersions } from '../app-versions/app-versions'
import { AppSettingsConnection } from './app-settings-connection'
import { AppSettingsGeneral } from './app-settings-general'

/** The Settings tab, as GitHub's: a menu of its sections beside the one chosen. */
export function AppSettings({ app }: { app: AppDTO }) {
  const { pathname } = useLocation()
  const base = `/apps/${app.id}/settings`

  return (
    <SidebarLayout
      menuLabel="Settings"
      aside={(
        <SideNav label="Settings">
          <SideNavItem href={base} active={pathname === base || pathname === `${base}/`} icon={SettingsIcon}>General</SideNavItem>
          <SideNavItem href={`${base}/connection`} active={pathname.startsWith(`${base}/connection`)} icon={PlugZapIcon}>Connection</SideNavItem>
          <SideNavItem href={`${base}/versions`} active={pathname.startsWith(`${base}/versions`)} icon={HistoryIcon}>Versions</SideNavItem>
        </SideNav>
      )}
    >
      <Routes>
        <Route index element={<AppSettingsGeneral app={app} />} />
        <Route path="connection" element={<AppSettingsConnection app={app} />} />
        <Route path="versions/*" element={<AppVersions app={app} />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </SidebarLayout>
  )
}
