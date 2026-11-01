import { useSearchParams } from 'react-router'
import { Alert } from '@newt-kit/react-ui/alert'
import { PageHeader } from '@newt-kit/react-ui/page-header'

/** A request auth cannot answer: what is wrong, and never a way back to an address nobody vouched for. */
export function OauthError() {
  const [search] = useSearchParams()

  return (
    <>
      <PageHeader title="The application cannot sign you in" description="It asked for access in a way Cooper does not accept. Go back to it and try again." />
      <Alert tone="bad" title="What happened">{search.get('message') ?? 'The request is not a valid one.'}</Alert>
    </>
  )
}
