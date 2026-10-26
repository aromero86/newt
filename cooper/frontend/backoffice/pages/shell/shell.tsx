import { Link, Outlet, useNavigation } from 'react-router'
import { AppShell } from '@cooper/ui/components/app-shell'
import { Logo } from '@cooper/ui/components/logo'
import { PageBody } from '@cooper/ui/components/page-body'
import { SidebarLayout } from '@cooper/ui/components/sidebar-layout'
import { Spinner } from '@cooper/ui/components/spinner'
import { ShellNav, useShellSectionLabel } from './shell-nav'
import { ShellThemeToggle } from './shell-theme-toggle'
import { ShellUserMenu } from './shell-user-menu'

/** The frame around every page: the bar with the brand and your menu, and the console's sections beside the page. */
export function Shell() {
  // A zone's code is still downloading: the current page stays until it arrives.
  const loading = useNavigation().state === 'loading'
  const section = useShellSectionLabel()

  return (
    <AppShell
      brand={<Link to="/" aria-label="Cooper Backoffice home"><Logo name="Cooper Backoffice" size="sm" /></Link>}
      actions={(
        <>
          {loading && <Spinner size="sm" label="Loading page" />}
          <ShellThemeToggle />
          <ShellUserMenu />
        </>
      )}
    >
      <PageBody>
        <SidebarLayout aside={<ShellNav />} menuLabel={section}>
          <Outlet />
        </SidebarLayout>
      </PageBody>
    </AppShell>
  )
}
