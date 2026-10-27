import { CompassIcon } from 'lucide-react'
import { Box, BoxEmpty } from 'newt-react-ui/box'
import { Button } from 'newt-react-ui/button'

/** An address that does not exist, or that you may not see: the same answer, as the backend gives. */
export function NotFound() {
  return (
    <Box label="Page not found">
      <BoxEmpty icon={CompassIcon} title="Page not found" description="This address does not exist in Cooper, or it is not yours to see." action={<Button size="sm" variant="outline" href="/">Go to the start</Button>} />
    </Box>
  )
}
