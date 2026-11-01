import { isRouteErrorResponse, useRouteError } from 'react-router'
import { Button } from 'newt-kit-react-ui/button'
import { PageHeader } from 'newt-kit-react-ui/page-header'
import { NotFound } from '../not-found/not-found'

/**
 * When a page fails. The usual cause is a new version deployed while the page was
 * open, so the code it asks for is gone: reloading fixes it. It lays out no width of
 * its own: inside the shell, the shell's page holds it.
 */
export function RouteError() {
  const error = useRouteError()

  return isRouteErrorResponse(error) && error.status === 404
    ? <NotFound />
    : (
        <PageHeader
          title="This page could not load"
          description="The backoffice may have been updated while you had it open. Reloading usually fixes it."
          actions={<Button onClick={() => location.reload()}>Reload</Button>}
        />
      )
}
