import { Link, Outlet, useLocation, useNavigation } from 'react-router'
import { AppShell } from '@newt/ui/components/app-shell'
import { Inline } from '@newt/ui/components/inline'
import { NavItem } from '@newt/ui/components/nav-item'
import { Spinner } from '@newt/ui/components/spinner'
import { Logo } from '@newt/ui/domain/logo'
import { ShellThemeToggle } from './shell-theme-toggle'
import { ShellUserMenu } from './shell-user-menu'

/** The frame around every page: brand, the zones, and the page itself. */
export function Shell() {
  // A zone's code is still downloading: the current page stays until it arrives.
  const loading = useNavigation().state === 'loading'
  const { pathname } = useLocation()
  const zone = (path: string) => ({ href: path, active: pathname === path || pathname.startsWith(`${path}/`) })

  return (
    <AppShell
      brand={<Link to="/" aria-label="newt home"><Logo /></Link>}
      nav={
        <>
          <NavItem {...zone('/definition')}>Definition</NavItem>
          <NavItem {...zone('/proposals')}>Proposals</NavItem>
          <NavItem {...zone('/releases')}>Releases</NavItem>
        </>
      }
      actions={
        <Inline gap={1}>
          {loading && <Spinner size="sm" label="Loading page" />}
          <ShellThemeToggle />
          <ShellUserMenu />
        </Inline>
      }
    >
      <Outlet />
    </AppShell>
  )
}
