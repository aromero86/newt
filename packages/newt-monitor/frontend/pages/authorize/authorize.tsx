import { useEffect } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { Alert } from '@newt-kit/react-ui/alert'
import { Button } from '@newt-kit/react-ui/button'
import { Card } from '@newt-kit/react-ui/card'
import { Inline } from '@newt-kit/react-ui/inline'
import { NarrowPage } from '@newt-kit/react-ui/narrow-page'
import { PageHeader } from '@newt-kit/react-ui/page-header'
import { Spinner } from '@newt-kit/react-ui/spinner'
import { Stack } from '@newt-kit/react-ui/stack'
import { Mono, Text } from '@newt-kit/react-ui/text'
import { Provide, useService, useValue } from '@newt-kit/react'
import { AUTHORIZATION_REQUEST_PROBLEMS } from '../../api/authorizations'
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
          title={<>An application calling itself “{review.clientName}” asks to read newt-monitor</>}
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
                  <Text>It will be answered at <Mono>{review.redirectHost}</Mono>.</Text>
                  {/* Anyone registers a client, under any name: the name proves nothing, where it is answered does. */}
                  <Alert tone="warn" title="Its name is not checked">Allow it only if you are connecting it yourself right now, and <Mono>{review.redirectHost}</Mono> is the application you expect.</Alert>
                </Stack>
              )
            : <Text>This request was answered already or has expired: go back to the application and connect it again.</Text>}
        </Card>
      )}
    </NarrowPage>
  )
}

/**
 * Where a request the monitor could not answer ends: why, never sent back to an address
 * nobody vouched for. The reason comes as a code and is told in the monitor's own words,
 * never in text taken from the address, which anyone can write.
 */
export function AuthorizeError() {
  const [params] = useSearchParams()
  const code = params.get('error') ?? ''
  const reason = Object.hasOwn(AUTHORIZATION_REQUEST_PROBLEMS, code)
    ? AUTHORIZATION_REQUEST_PROBLEMS[code as keyof typeof AUTHORIZATION_REQUEST_PROBLEMS]
    : AUTHORIZATION_REQUEST_PROBLEMS['oauthGrant.invalid_request']
  return (
    <NarrowPage>
      <Brand size="lg" />
      <PageHeader title="Connect an application" />
      <Alert tone="bad" title="The application asked for access the wrong way">{reason}.</Alert>
    </NarrowPage>
  )
}
