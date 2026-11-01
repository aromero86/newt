import { CompassIcon } from 'lucide-react'
import { Box, BoxEmpty } from '@newt-kit/react-ui/box'
import { Button } from '@newt-kit/react-ui/button'

/** An address that does not exist. */
export function NotFound() {
  return (
    <Box label="Page not found">
      <BoxEmpty icon={CompassIcon} title="Page not found" description="This address does not exist in the monitor." action={<Button size="sm" variant="outline" href="/">Go to the applications</Button>} />
    </Box>
  )
}
