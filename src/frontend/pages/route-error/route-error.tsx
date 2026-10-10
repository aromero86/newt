import { isRouteErrorResponse, useRouteError } from 'react-router'
import { Button } from '@newt/ui/components/button'
import { PageHeader } from '@newt/ui/components/page-header'
import { NotFound } from '../not-found/not-found'

/**
 * When a page fails. The usual cause is a new version deployed while the page was
 * open, so the code it asks for is gone: reloading fixes it.
 */
export function RouteError() {
  const error = useRouteError()
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFound />

  return (
    <PageHeader
      title="This page could not load"
      description="newt may have been updated while you had it open. Reloading usually fixes it."
      actions={<Button onClick={() => location.reload()}>Reload</Button>}
    />
  )
}
