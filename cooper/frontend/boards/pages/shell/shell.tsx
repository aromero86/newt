import { Link, Outlet, useNavigation } from 'react-router'
import { AppShell } from '@cooper/ui/components/app-shell'
import { Logo } from '@cooper/ui/components/logo'
import { Spinner } from '@cooper/ui/components/spinner'
import { ShellThemeToggle } from './shell-theme-toggle'

/** The frame around every page: the brand, and the actions at the end of the bar. */
export function Shell() {
  // A zone's code is still downloading: the current page stays until it arrives.
  const loading = useNavigation().state === 'loading'

  return (
    <AppShell
      brand={<Link to="/" aria-label="Cooper home"><Logo name="Cooper" size="sm" /></Link>}
      actions={(
        <>
          {loading && <Spinner size="sm" label="Loading page" />}
          <ShellThemeToggle />
        </>
      )}
    >
      <Outlet />
    </AppShell>
  )
}
