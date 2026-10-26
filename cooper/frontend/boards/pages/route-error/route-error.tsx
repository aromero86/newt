import { isRouteErrorResponse, useRouteError } from 'react-router'
import { Button } from '@cooper/ui/components/button'
import { PageBody } from '@cooper/ui/components/page-body'
import { PageHeader } from '@cooper/ui/components/page-header'
import { NotFound } from '../not-found/not-found'

/**
 * When a page fails. The usual cause is a new version deployed while the page was
 * open, so the code it asks for is gone: reloading fixes it.
 */
export function RouteError() {
  const error = useRouteError()

  return (
    <PageBody>
      {isRouteErrorResponse(error) && error.status === 404
        ? <NotFound />
        : (
            <PageHeader
              title="This page could not load"
              description="Cooper may have been updated while you had it open. Reloading usually fixes it."
              actions={<Button onClick={() => location.reload()}>Reload</Button>}
            />
          )}
    </PageBody>
  )
}
