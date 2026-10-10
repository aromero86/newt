import { Link, Outlet, useLocation, useMatch, useNavigation } from 'react-router'
import { AppShell } from '@newt/ui/components/app-shell'
import { Inline } from '@newt/ui/components/inline'
import { NavItem } from '@newt/ui/components/nav-item'
import { Spinner } from '@newt/ui/components/spinner'
import { Logo } from '@newt/ui/domain/logo'
import { useService } from '../../core/injector/use-service'
import { useValue } from '../../core/store/use-value'
import { WorkspacesService } from '../../services/workspaces/workspaces.service'
import { ShellThemeToggle } from './shell-theme-toggle'
import { ShellUserMenu } from './shell-user-menu'
import { ShellWorkspaceMenu } from './shell-workspace-menu'

/** The frame around every page: brand, the zones, and the page itself. */
export function Shell() {
  // A zone's code is still downloading: the current page stays until it arrives.
  const loading = useNavigation().state === 'loading'
  const { pathname } = useLocation()
  // The zones belong to a workspace: they show only inside one the person is in.
  const workspaceId = useMatch('/w/:workspaceId/*')?.params.workspaceId
  const workspace = useValue(useService(WorkspacesService).workspace(workspaceId ?? ''))
  const zone = (path: string) => {
    const href = `/w/${workspaceId}${path}`
    return { href, active: pathname === href || pathname.startsWith(`${href}/`) }
  }

  return (
    <AppShell
      brand={<Link to="/" aria-label="newt home"><Logo /></Link>}
      nav={
        <>
          <ShellWorkspaceMenu workspaceId={workspaceId} />
          {workspace && (
            <>
              <NavItem {...zone('/definition')}>Definition</NavItem>
              <NavItem {...zone('/proposals')}>Proposals</NavItem>
              <NavItem {...zone('/releases')}>Releases</NavItem>
              <NavItem {...zone('/settings')}>Settings</NavItem>
            </>
          )}
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
