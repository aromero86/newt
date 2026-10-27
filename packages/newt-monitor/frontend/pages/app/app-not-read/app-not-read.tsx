import { BlocksIcon, RefreshCwIcon } from 'lucide-react'
import { Box, BoxEmpty } from 'newt-react-ui/box'
import { Button } from 'newt-react-ui/button'
import { Icon } from 'newt-react-ui/icon'
import { useService, useValue } from 'newt-react'
import type { AppDTO } from '../../../api/app'
import { AppService } from '../app.service'

/** What a tab of its structure shows while none was read. */
export function AppNotRead({ app }: { app: AppDTO }) {
  const service = useService(AppService)
  const refreshing = useValue(service.refreshing)

  return (
    <Box label="Structure">
      <BoxEmpty
        icon={BlocksIcon}
        title="Its structure was not read yet"
        description="The monitor reads it every hour, and when asked."
        action={app.archivedAt ? undefined : <Button size="sm" variant="outline" loading={refreshing} onClick={() => void service.refresh()}><Icon icon={RefreshCwIcon} size="sm" />Read it now</Button>}
      />
    </Box>
  )
}
