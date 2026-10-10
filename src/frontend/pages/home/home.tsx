import { Card } from '@newt/ui/components/card'
import { Grid } from '@newt/ui/components/grid'
import { PageHeader } from '@newt/ui/components/page-header'
import { Stack } from '@newt/ui/components/stack'
import { Text } from '@newt/ui/components/text'
import { TextLink } from '@newt/ui/components/link'
import { HomeApiStatus } from './home-api-status'

const zones = [
  { to: '/definition', title: 'Definition', description: 'What your product does today, and what it will do once accepted proposals ship.' },
  { to: '/proposals', title: 'Proposals', description: 'Changes to the definition, approved delta by delta.' },
  { to: '/releases', title: 'Releases', description: 'Product versions that ship together with the code.' },
]

export function Home() {
  return (
    <Stack gap={8}>
      <PageHeader title="newt" description="The living definition of your product." actions={<HomeApiStatus />} />
      <Grid columns={{ base: 1, md: 3 }} gap={4}>
        {zones.map(zone => (
          <Card key={zone.to} title={zone.title} description={zone.description} footer={<TextLink href={zone.to}>Open {zone.title.toLowerCase()}</TextLink>}>
            <Text tone="muted" size="sm">Empty for now.</Text>
          </Card>
        ))}
      </Grid>
    </Stack>
  )
}
