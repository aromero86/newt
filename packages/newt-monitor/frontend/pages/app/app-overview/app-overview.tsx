import { BlocksIcon, PlugZapIcon } from 'lucide-react'
import { Alert } from 'newt-react-ui/alert'
import { Box, BoxEmpty, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from 'newt-react-ui/box'
import { Counter } from 'newt-react-ui/counter'
import { Grid } from 'newt-react-ui/grid'
import { Icon } from 'newt-react-ui/icon'
import { TextLink } from 'newt-react-ui/link'
import { RelativeTime } from 'newt-react-ui/relative-time'
import { Stack } from 'newt-react-ui/stack'
import { Stat } from 'newt-react-ui/stat'
import { useService, useValue } from 'newt-react'
import type { AppDTO } from '../../../api/app'
import { ConnectionBadge } from '../../../components/connection-badge/connection-badge'
import { AppNotRead } from '../app-not-read/app-not-read'
import { AppOverviewFailures } from './app-overview-failures'
import { AppOverviewQueues } from './app-overview-queues'
import { AppOverviewRetries } from './app-overview-retries'
import { AppService } from '../app.service'
import { AppGraph } from '../app-graph/app-graph'
import { contextHref, contextsGraph } from '../app-structure'

/** What the monitor knows of an application at a glance: what it is made of, and whether it answers. */
export function AppOverview({ app }: { app: AppDTO }) {
  const service = useService(AppService)
  const structure = useValue(service.structure)
  const counts = useValue(service.counts)

  return (
    <Stack gap={6}>
      {app.archivedAt && (
        <Alert tone="warn" title="This application is archived">
          It is not watched, and everything known of it is kept. <TextLink href={`/apps/${app.id}/settings`}>Restore it</TextLink> to watch it again.
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
        : <AppNotRead app={app} />}
      {/* An archived application is not watched: whether it answers is nobody's concern. */}
      {!app.archivedAt && <AppOverviewConnection />}
      {structure && <AppOverviewFailures app={app} />}
      {structure && <AppOverviewRetries app={app} />}
      {structure && <AppOverviewQueues app={app} />}
      {structure && structure.description.contexts.length > 1 && (
        <AppGraph title="How its contexts use each other" graph={() => contextsGraph(app.id, structure.description)} />
      )}
      {structure && (
        <Box label="Contexts">
          <BoxHeader>Contexts <Counter>{counts.contexts}</Counter></BoxHeader>
          {structure.description.contexts.map(context => (
            <BoxRow key={context.name} leading={<Icon icon={BlocksIcon} tone="muted" />} trailing={<>{context.modules.length} modules</>}>
              <BoxRowTitle href={contextHref(app.id, context.name)}>{context.name}</BoxRowTitle>
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
