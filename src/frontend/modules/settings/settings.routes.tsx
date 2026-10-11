import { Route, Routes, useLocation } from 'react-router'
import { BotIcon, KeyRoundIcon, UserIcon } from 'lucide-react'
import { Avatar } from '@newt/ui/components/avatar'
import { Inline } from '@newt/ui/components/inline'
import { PageBody } from '@newt/ui/components/page-body'
import { SideNav, SideNavItem } from '@newt/ui/components/side-nav'
import { SidebarLayout } from '@newt/ui/components/sidebar-layout'
import { Stack } from '@newt/ui/components/stack'
import { Text } from '@newt/ui/components/text'
import { useService } from '../../core/injector/use-service'
import { useValue } from '../../core/store/use-value'
import { NotFound } from '../../pages/not-found/not-found'
import { SessionService } from '../../services/session/session.service'
import { SettingsAssistants } from './settings-assistants/settings-assistants'
import { SettingsPassword } from './settings-password/settings-password'
import { SettingsProfile } from './settings-profile/settings-profile'

/** The account's settings, below /settings: who you are, beside a menu of sections. */
export function SettingsRoutes() {
  const user = useValue(useService(SessionService).user)
  const { pathname } = useLocation()

  const menu = (
    <SideNav label="Account settings">
      <SideNavItem href="/settings" active={pathname === '/settings'} icon={UserIcon}>Profile</SideNavItem>
      <SideNavItem href="/settings/password" active={pathname === '/settings/password'} icon={KeyRoundIcon}>Password</SideNavItem>
      <SideNavItem href="/settings/assistants" active={pathname === '/settings/assistants'} icon={BotIcon}>AI assistants</SideNavItem>
    </SideNav>
  )

  return (
    <PageBody>
      <Stack gap={8}>
        {user && (
          <Inline gap={3}>
            <Avatar name={user.fullName} size={8} />
            <Stack gap={0}>
              <Text weight="semibold">{user.fullName}</Text>
              <Text size="sm" tone="muted">{`@${user.nick} · your account`}</Text>
            </Stack>
          </Inline>
        )}
        <SidebarLayout aside={menu}>
          <Routes>
            <Route index element={<SettingsProfile />} />
            <Route path="password" element={<SettingsPassword />} />
            <Route path="assistants" element={<SettingsAssistants />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </SidebarLayout>
      </Stack>
    </PageBody>
  )
}
