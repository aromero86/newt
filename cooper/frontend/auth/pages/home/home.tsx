import { Card } from '@cooper/ui/components/card'
import { PageHeader } from '@cooper/ui/components/page-header'
import { Text } from '@cooper/ui/components/text'

/** Where auth opens. A placeholder until signing in, signing up and consent arrive. */
export function Home() {
  return (
    <>
      <PageHeader title="Sign in to Cooper" />
      <Card>
        <Text size="sm" tone="muted">Signing in arrives soon. Cooper and its backoffice send you here when they need to know who you are.</Text>
      </Card>
    </>
  )
}
