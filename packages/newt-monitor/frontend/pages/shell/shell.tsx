import { Link, Outlet, useNavigation } from 'react-router'
import { ActivityIcon } from 'lucide-react'
import { AppShell } from 'newt-react-ui/app-shell'
import { Icon } from 'newt-react-ui/icon'
import { Inline } from 'newt-react-ui/inline'
import { PageBody } from 'newt-react-ui/page-body'
import { Spinner } from 'newt-react-ui/spinner'
import { Text } from 'newt-react-ui/text'
import { ShellThemeToggle } from './shell-theme-toggle'

/** The frame around every page: the bar with the brand and its actions, and the page below it. */
export function Shell() {
  // A zone's code is still downloading: the current page stays until it arrives.
  const loading = useNavigation().state === 'loading'

  return (
    <AppShell
      brand={(
        <Link to="/" aria-label="newt-monitor home">
          <Inline gap={2}>
            <Icon icon={ActivityIcon} size="lg" />
            <Text weight="semibold">newt-monitor</Text>
          </Inline>
        </Link>
      )}
      actions={(
        <>
          {loading && <Spinner size="sm" label="Loading page" />}
          <ShellThemeToggle />
        </>
      )}
    >
      <PageBody>
        <Outlet />
      </PageBody>
    </AppShell>
  )
}
