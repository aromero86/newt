import { useEffect } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { Alert } from 'newt-react-ui/alert'
import { Button } from 'newt-react-ui/button'
import { Card } from 'newt-react-ui/card'
import { Inline } from 'newt-react-ui/inline'
import { NarrowPage } from 'newt-react-ui/narrow-page'
import { PageHeader } from 'newt-react-ui/page-header'
import { Spinner } from 'newt-react-ui/spinner'
import { Stack } from 'newt-react-ui/stack'
import { Mono, Text } from 'newt-react-ui/text'
import { Provide, useService, useValue } from 'newt-react'
import { Brand } from '../../components/brand/brand'
import { AuthorizeService } from './authorize.service'

/**
 * Where an application (Claude, an MCP client) sends the person to ask for access to
 * the monitor's MCP server: signed in, they say yes or no, and go back to it.
 */
export function Authorize() {
  return (
    <Provide services={[AuthorizeService]}>
      <AuthorizeWrapped />
    </Provide>
  )
}

function AuthorizeWrapped() {
  const id = useParams().id!
  const service = useService(AuthorizeService)
  const review = useValue(service.review)
  const answering = useValue(service.answering)
  const failure = useValue(service.failure)

  useEffect(() => {
    void service.open(id)
  }, [service, id])

  return (
    <NarrowPage>
      <Brand size="lg" />
      <PageHeader title="Connect an application" />
      {!review && !failure && <Spinner label="Loading the request" />}
      {failure && <Alert tone="bad" title="Could not go on">{failure}</Alert>}
      {review && (
        <Card
          title={<>{review.clientName} asks to read newt-monitor</>}
          footer={review.open && (
            <Inline gap={2}>
              <Button loading={answering === 'approve'} disabled={answering !== null} onClick={() => void service.answer('approve')}>Allow</Button>
              <Button variant="outline" loading={answering === 'deny'} disabled={answering !== null} onClick={() => void service.answer('deny')}>Deny</Button>
            </Inline>
          )}
        >
          {review.open
            ? (
                <Stack gap={2}>
                  <Text>It will see everything the monitor knows of every application: their structure, metrics, traces, queues, servers and instances. It cannot change anything.</Text>
                  <Text size="sm" tone="muted">You go back to <Mono>{review.redirectHost}</Mono> after answering.</Text>
                </Stack>
              )
            : <Text>This request was answered already or has expired: go back to the application and connect it again.</Text>}
        </Card>
      )}
    </NarrowPage>
  )
}

/** Where a request the monitor could not answer ends: why, never sent back to an address nobody vouched for. */
export function AuthorizeError() {
  const [params] = useSearchParams()
  return (
    <NarrowPage>
      <Brand size="lg" />
      <PageHeader title="Connect an application" />
      <Alert tone="bad" title="The application asked for access the wrong way">{params.get('message') ?? 'The request is not a valid one.'}</Alert>
    </NarrowPage>
  )
}
