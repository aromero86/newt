import { useLocation } from 'react-router'
import { BarChart3Icon, LayersIcon, ShieldCheckIcon, UsersIcon } from 'lucide-react'
import { SideNav, SideNavItem } from '@cooper/ui/components/side-nav'

/** The console's sections, the one you are in marked. */
export function ShellNav() {
  const { pathname } = useLocation()
  const within = (path: string) => pathname === path || pathname.startsWith(`${path}/`)

  return (
    <SideNav label="Backoffice">
      <SideNavItem href="/" active={pathname === '/'} icon={BarChart3Icon}>Overview</SideNavItem>
      <SideNavItem href="/workspaces" active={within('/workspaces')} icon={LayersIcon}>Workspaces</SideNavItem>
      <SideNavItem href="/users" active={within('/users')} icon={UsersIcon}>Users</SideNavItem>
      <SideNavItem href="/staff" active={within('/staff')} icon={ShieldCheckIcon}>Staff</SideNavItem>
    </SideNav>
  )
}
