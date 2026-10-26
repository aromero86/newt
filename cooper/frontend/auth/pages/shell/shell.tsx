import { Link, Outlet, useNavigation } from 'react-router'
import { Inline } from '@cooper/ui/components/inline'
import { Logo } from '@cooper/ui/components/logo'
import { NarrowPage } from '@cooper/ui/components/narrow-page'
import { Spinner } from '@cooper/ui/components/spinner'
import { ShellThemeToggle } from './shell-theme-toggle'

/** The frame of every auth page: one narrow column with the brand over a card. */
export function Shell() {
  // A page's code is still downloading: the current page stays until it arrives.
  const loading = useNavigation().state === 'loading'

  return (
    <NarrowPage>
      <Inline justify="between">
        <Link to="/" aria-label="Cooper"><Logo name="Cooper" /></Link>
        <Inline gap={1}>
          {loading && <Spinner size="sm" label="Loading page" />}
          <ShellThemeToggle />
        </Inline>
      </Inline>
      <Outlet />
    </NarrowPage>
  )
}
