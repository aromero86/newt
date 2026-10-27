import { BlocksIcon, PlugZapIcon, RefreshCwIcon } from 'lucide-react'
import { Alert } from 'newt-react-ui/alert'
import { Box, BoxEmpty, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from 'newt-react-ui/box'
import { Button } from 'newt-react-ui/button'
import { Grid } from 'newt-react-ui/grid'
import { Icon } from 'newt-react-ui/icon'
import { RelativeTime } from 'newt-react-ui/relative-time'
import { Stack } from 'newt-react-ui/stack'
import { Stat } from 'newt-react-ui/stat'
import { Counter } from 'newt-react-ui/counter'
import { useService, useValue } from 'newt-react'
import type { AppDTO } from '../../../api/app'
import { ConnectionBadge } from '../../../components/connection-badge/connection-badge'
import { AppService } from '../app.service'

/** What the monitor knows of an application at a glance: what it is made of, and whether it answers. */
export function AppOverview({ app }: { app: AppDTO }) {
  const service = useService(AppService)
  const structure = useValue(service.structure)
  const counts = useValue(service.counts)
  const refreshing = useValue(service.refreshing)
  const base = `/apps/${app.id}`

  return (
    <Stack gap={6}>
      {app.archivedAt && (
        <Alert tone="warn" title="This application is archived">
          It is not watched, and everything known of it is kept. Restore it to watch it again.
        </Alert>
      )}
      {structure
        ? (
            <Grid columns={{ base: 2, md: 4 }}>
              <Stat label="Contexts" value={counts.contexts} hint={<>read <RelativeTime date={structure.takenAt} /></>} />
              <Stat label="Modules" value={counts.modules} />
              <Stat label="Use cases" value={counts.useCases} />
              <Stat label="Events" value={counts.events} />
            </Grid>
          )
        : (
            <Box label="Structure">
              <BoxEmpty
                icon={BlocksIcon}
                title="Its structure was not read yet"
                description="The monitor reads it every hour, and when asked."
                action={app.archivedAt ? undefined : <Button size="sm" variant="outline" loading={refreshing} onClick={() => void service.refresh()}><Icon icon={RefreshCwIcon} size="sm" />Read it now</Button>}
              />
            </Box>
          )}
      {/* An archived application is not watched: whether it answers is nobody's concern. */}
      {!app.archivedAt && <AppOverviewConnection />}
      {structure && (
        <Box label="Contexts">
          <BoxHeader>Contexts <Counter>{counts.contexts}</Counter></BoxHeader>
          {structure.description.contexts.map(context => (
            <BoxRow key={context.name} leading={<Icon icon={BlocksIcon} tone="muted" />} trailing={<>{context.modules.length} modules</>}>
              <BoxRowTitle href={`${base}/contexts/${context.name}`}>{context.name}</BoxRowTitle>
              <BoxRowMeta>
                <>{context.uses.length ? `uses ${context.uses.join(', ')}` : 'uses no other context'}</>
                <>{context.modules.reduce((sum, module) => sum + module.useCases.length, 0)} use cases</>
                <>{context.modules.reduce((sum, module) => sum + module.events.length, 0)} events</>
              </BoxRowMeta>
            </BoxRow>
          ))}
        </Box>
      )}
    </Stack>
  )
}

/** Whether it answers, and which process of it answered when it was last asked who it is. */
function AppOverviewConnection() {
  const service = useService(AppService)
  const connection = useValue(service.connection)
  if (!connection) return null
  const { identity, failure } = connection

  return (
    <Box label="Connection">
      <BoxHeader actions={<ConnectionBadge status={connection.status} />}>Connection</BoxHeader>
      {connection.status === 'unknown'
        ? <BoxEmpty icon={PlugZapIcon} title="Not checked yet" description="The monitor asks it before every read of its structure." />
        : (
            <BoxRow leading={<Icon icon={PlugZapIcon} tone={connection.status === 'up' ? 'ok' : 'bad'} />}>
              <BoxRowTitle>{failure ? 'It does not answer' : identity ? `${identity.name} answers, on newt ${identity.newt}` : 'It answers'}</BoxRowTitle>
              <BoxRowMeta>
                {failure && <>{failure.message}</>}
                {identity && <>{identity.instance.host}, process {identity.instance.pid}, started <RelativeTime date={identity.startedAt} /></>}
                <>checked <RelativeTime date={connection.checkedAt} /></>
                {failure && <>{connection.lastSeenAt ? <>last answered <RelativeTime date={connection.lastSeenAt} /></> : 'it never answered'}</>}
              </BoxRowMeta>
            </BoxRow>
          )}
    </Box>
  )
}
