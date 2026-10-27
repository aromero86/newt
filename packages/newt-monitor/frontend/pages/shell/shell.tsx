import { Link, Outlet, useNavigation } from 'react-router'
import { AppShell } from 'newt-react-ui/app-shell'
import { PageBody } from 'newt-react-ui/page-body'
import { Spinner } from 'newt-react-ui/spinner'
import { Brand } from '../../components/brand/brand'
import { ShellThemeToggle } from './shell-theme-toggle'
import { ShellUserMenu } from './shell-user-menu'

/** The frame around every page: the bar with the brand, the theme and your menu, and the page below it. */
export function Shell() {
  // A zone's code is still downloading: the current page stays until it arrives.
  const loading = useNavigation().state === 'loading'

  return (
    <AppShell
      brand={(
        <Link to="/" aria-label="newt-monitor home"><Brand /></Link>
      )}
      actions={(
        <>
          {loading && <Spinner size="sm" label="Loading page" />}
          <ShellThemeToggle />
          <ShellUserMenu />
        </>
      )}
    >
      <PageBody>
        <Outlet />
      </PageBody>
    </AppShell>
  )
}
