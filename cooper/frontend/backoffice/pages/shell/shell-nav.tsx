import { useLocation } from 'react-router'
import { BarChart3Icon, LayersIcon, ListRestartIcon, ShieldCheckIcon, UsersIcon } from 'lucide-react'
import { SideNav, SideNavItem } from '@newt-kit/react-ui/side-nav'

/** The console's sections, in the order the menu shows them. */
const SECTIONS = [
  { href: '/', label: 'Overview', icon: BarChart3Icon },
  { href: '/workspaces', label: 'Workspaces', icon: LayersIcon },
  { href: '/users', label: 'Users', icon: UsersIcon },
  { href: '/staff', label: 'Staff', icon: ShieldCheckIcon },
  { href: '/jobs', label: 'Jobs', icon: ListRestartIcon },
]

/** The section the address is in: the overview only at the start, the others with everything below them. */
function useSection() {
  const { pathname } = useLocation()
  return SECTIONS.find(({ href }) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)))
}

/** The name of the section you are in, for the folded menu on narrow screens. */
export function useShellSectionLabel(): string {
  return useSection()?.label ?? 'Sections'
}

/** The console's sections, the one you are in marked. */
export function ShellNav() {
  const current = useSection()

  return (
    <SideNav label="Backoffice">
      {SECTIONS.map(section => (
        <SideNavItem key={section.href} href={section.href} active={section === current} icon={section.icon}>{section.label}</SideNavItem>
      ))}
    </SideNav>
  )
}
