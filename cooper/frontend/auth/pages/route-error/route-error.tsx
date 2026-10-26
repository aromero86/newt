import { isRouteErrorResponse, useRouteError } from 'react-router'
import { Button } from '@cooper/ui/components/button'
import { Card } from '@cooper/ui/components/card'
import { NarrowPage } from '@cooper/ui/components/narrow-page'
import { Text } from '@cooper/ui/components/text'
import { NotFound } from '../not-found/not-found'

/**
 * When a page fails. The usual cause is a new version deployed while the page was
 * open, so the code it asks for is gone: reloading fixes it. It brings its own
 * narrow page, since the shell may be what failed.
 */
export function RouteError() {
  const error = useRouteError()

  return (
    <NarrowPage>
      {isRouteErrorResponse(error) && error.status === 404
        ? <NotFound />
        : (
            <Card title="This page could not load" titleLevel={2} footer={<Button onClick={() => location.reload()}>Reload</Button>}>
              <Text size="sm" tone="muted">Cooper may have been updated while you had it open. Reloading usually fixes it.</Text>
            </Card>
          )}
    </NarrowPage>
  )
}
