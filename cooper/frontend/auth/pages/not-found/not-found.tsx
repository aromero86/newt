import { CompassIcon } from 'lucide-react'
import { Box, BoxEmpty } from '@cooper/ui/components/box'
import { Button } from '@cooper/ui/components/button'

/** An address that does not exist. */
export function NotFound() {
  return (
    <Box label="Page not found">
      <BoxEmpty icon={CompassIcon} title="Page not found" description="This address does not exist in Cooper." action={<Button size="sm" variant="outline" href="/">Go to the start</Button>} />
    </Box>
  )
}
