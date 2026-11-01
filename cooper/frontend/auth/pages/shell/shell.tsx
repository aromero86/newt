import { Link, Outlet, useNavigation } from 'react-router'
import { Inline } from '@newt-kit/react-ui/inline'
import { Logo } from '@cooper/ui/components/logo'
import { NarrowPage } from '@newt-kit/react-ui/narrow-page'
import { Spinner } from '@newt-kit/react-ui/spinner'
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
