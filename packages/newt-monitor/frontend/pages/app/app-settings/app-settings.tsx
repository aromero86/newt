import { Route, Routes, useLocation } from 'react-router'
import { HistoryIcon, PinIcon, PlugZapIcon, SettingsIcon } from 'lucide-react'
import { SideNav, SideNavItem } from '@newt-kit/react-ui/side-nav'
import { SidebarLayout } from '@newt-kit/react-ui/sidebar-layout'
import type { AppDTO } from '../../../api/app'
import { NotFound } from '../../not-found/not-found'
import { AppVersions } from '../app-versions/app-versions'
import { AppSettingsConnection } from './app-settings-connection'
import { AppSettingsGeneral } from './app-settings-general'
import { AppSettingsTraceRequest } from './app-settings-trace-request'

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
          <SideNavItem href={`${base}/trace-request`} active={pathname.startsWith(`${base}/trace-request`)} icon={PinIcon}>Trace a request</SideNavItem>
          <SideNavItem href={`${base}/versions`} active={pathname.startsWith(`${base}/versions`)} icon={HistoryIcon}>Versions</SideNavItem>
        </SideNav>
      )}
    >
      <Routes>
        <Route index element={<AppSettingsGeneral app={app} />} />
        <Route path="connection" element={<AppSettingsConnection app={app} />} />
        <Route path="trace-request" element={<AppSettingsTraceRequest app={app} />} />
        <Route path="versions/*" element={<AppVersions app={app} />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </SidebarLayout>
  )
}
