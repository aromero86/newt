import { PageHeader } from '@newt/ui/components/page-header'
import { Stack } from '@newt/ui/components/stack'
import { TextLink } from '@newt/ui/components/link'

export function NotFound() {
  return (
    <Stack gap={4}>
      <PageHeader title="Page not found" description="This address does not exist in newt." />
      <TextLink href="/">Go to the start</TextLink>
    </Stack>
  )
}
