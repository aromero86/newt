import { PlugZapIcon } from 'lucide-react'
import { Box, BoxEmpty, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from '@newt-kit/react-ui/box'
import { Icon } from '@newt-kit/react-ui/icon'
import { TextLink } from '@newt-kit/react-ui/link'
import { RelativeTime } from '@newt-kit/react-ui/relative-time'
import { Stack } from '@newt-kit/react-ui/stack'
import { Subhead } from '@newt-kit/react-ui/subhead'
import { useService, useValue } from '@newt-kit/react'
import type { AppDTO } from '../../../api/app'
import { ConnectionBadge } from '../../../components/connection-badge/connection-badge'
import { AppService } from '../app.service'

/** Settings' Connection: whether it answers, on which newt, and which process of it answered when it was last asked who it is, and how many are alive. */
export function AppSettingsConnection({ app }: { app: AppDTO }) {
  const service = useService(AppService)
  const connection = useValue(service.connection)
  const instances = useValue(service.instances)
  const alive = instances?.instances.filter(instance => instance.status === 'alive').length ?? 0

  return (
    <Stack gap={0}>
      <Subhead title="Connection" description={app.archivedAt ? 'It is archived: nobody asks it whether it answers.' : 'The monitor asks it who it is before every read of its structure.'} />
      {connection && (
        <Box label="Connection">
          <BoxHeader actions={<ConnectionBadge status={connection.status} />}>Last check</BoxHeader>
          {connection.status === 'unknown'
            ? <BoxEmpty icon={PlugZapIcon} title="Not checked yet" description="The monitor asks it before every read of its structure." />
            : (
                <BoxRow leading={<Icon icon={PlugZapIcon} tone={connection.status === 'up' ? 'ok' : 'bad'} />}>
                  <BoxRowTitle>{connection.failure ? 'It does not answer' : connection.identity ? `${connection.identity.name} answers, on newt ${connection.identity.newt}` : 'It answers'}</BoxRowTitle>
                  <BoxRowMeta>
                    {connection.failure && <>{connection.failure.message}</>}
                    {connection.identity && <>{connection.identity.instance.host}, process {connection.identity.instance.pid}, started <RelativeTime date={connection.identity.startedAt} /></>}
                    {instances && instances.instances.length > 0 && <TextLink href={`/apps/${app.id}/system`}>{alive} {alive === 1 ? 'instance' : 'instances'} alive</TextLink>}
                    <>checked <RelativeTime date={connection.checkedAt} /></>
                    {connection.failure && <>{connection.lastSeenAt ? <>last answered <RelativeTime date={connection.lastSeenAt} /></> : 'it never answered'}</>}
                  </BoxRowMeta>
                </BoxRow>
              )}
        </Box>
      )}
    </Stack>
  )
}
