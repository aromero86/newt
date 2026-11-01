import { isRouteErrorResponse, useRouteError } from 'react-router'
import { Button } from 'newt-kit-react-ui/button'
import { Card } from 'newt-kit-react-ui/card'
import { NarrowPage } from 'newt-kit-react-ui/narrow-page'
import { Text } from 'newt-kit-react-ui/text'
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
