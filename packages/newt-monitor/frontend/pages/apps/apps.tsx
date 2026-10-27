import { ActivityIcon } from 'lucide-react'
import { Box, BoxEmpty } from 'newt-react-ui/box'
import { PageHeader } from 'newt-react-ui/page-header'
import { Stack } from 'newt-react-ui/stack'

/** The applications the monitor watches. */
export function Apps() {
  return (
    <Stack gap={4}>
      <PageHeader title="Applications" description="The newt applications this monitor watches." />
      <Box label="Applications">
        <BoxEmpty icon={ActivityIcon} title="No applications yet" description="The monitor's pages are on their way." />
      </Box>
    </Stack>
  )
}
