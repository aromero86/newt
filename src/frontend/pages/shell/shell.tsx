import { Link, Outlet, useMatch, useNavigation } from 'react-router'
import { AppShell } from '@newt/ui/components/app-shell'
import { Spinner } from '@newt/ui/components/spinner'
import { Logo } from '@newt/ui/domain/logo'
import { ShellThemeToggle } from './shell-theme-toggle'
import { ShellUserMenu } from './shell-user-menu'
import { ShellWorkspaceMenu } from './shell-workspace-menu'

/** The frame around every page: the brand, which workspace you are in, and your menu. */
export function Shell() {
  // A zone's code is still downloading: the current page stays until it arrives.
  const loading = useNavigation().state === 'loading'
  const workspaceId = useMatch('/w/:workspaceId/*')?.params.workspaceId

  return (
    <AppShell
      brand={<Link to="/" aria-label="newt home"><Logo size="sm" /></Link>}
      context={<ShellWorkspaceMenu workspaceId={workspaceId} />}
      actions={(
        <>
          {loading && <Spinner size="sm" label="Loading page" />}
          <ShellThemeToggle />
          <ShellUserMenu />
        </>
      )}
    >
      <Outlet />
    </AppShell>
  )
}
