import { BlocksIcon } from 'lucide-react'
import { Alert } from '@newt-kit/react-ui/alert'
import { Box, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from '@newt-kit/react-ui/box'
import { Counter } from '@newt-kit/react-ui/counter'
import { Grid } from '@newt-kit/react-ui/grid'
import { Icon } from '@newt-kit/react-ui/icon'
import { Inline } from '@newt-kit/react-ui/inline'
import { TextLink } from '@newt-kit/react-ui/link'
import { RelativeTime } from '@newt-kit/react-ui/relative-time'
import { Stack } from '@newt-kit/react-ui/stack'
import { Stat } from '@newt-kit/react-ui/stat'
import { Text } from '@newt-kit/react-ui/text'
import { useService, useValue } from '@newt-kit/react'
import type { AppDTO } from '../../../api/app'
import { ConnectionBadge } from '../../../components/connection-badge/connection-badge'
import { AppNotRead } from '../app-not-read/app-not-read'
import { AppOverviewFailures } from './app-overview-failures'
import { AppOverviewQueues } from './app-overview-queues'
import { AppOverviewUseCases } from './app-overview-use-cases'
import { AppOverviewRetries } from './app-overview-retries'
import { AppOverviewSystem } from './app-overview-system'
import { AppService } from '../app.service'
import { AppGraph } from '../app-graph/app-graph'
import { contextHref, contextsGraph } from '../app-structure'

/**
 * What the monitor knows of an application at a glance, as a dashboard: whether it answers
 * (its details in Settings), what it is made of, how its use cases went, and side by side
 * what to look at first.
 */
export function AppOverview({ app }: { app: AppDTO }) {
  const service = useService(AppService)
  const structure = useValue(service.structure)
  const connection = useValue(service.connection)
  const counts = useValue(service.counts)

  return (
    <Stack gap={6}>
      {app.archivedAt && (
        <Alert tone="warn" title="This application is archived">
          It is not watched, and everything known of it is kept. <TextLink href={`/apps/${app.id}/settings`}>Restore it</TextLink> to watch it again.
        </Alert>
      )}
      {/* An archived application is not watched: whether it answers is nobody's concern. */}
      {(!app.archivedAt && connection) || structure
        ? (
            <Inline gap={3} wrap>
              {!app.archivedAt && connection && <ConnectionBadge status={connection.status} href={`/apps/${app.id}/settings/connection`} />}
              {structure && <Text size="sm" tone="muted">Structure read <RelativeTime date={structure.takenAt} /></Text>}
            </Inline>
          )
        : null}
      {structure
        ? (
            <Grid columns={{ base: 2, md: 4 }}>
              <Stat label="Contexts" value={counts.contexts} />
              <Stat label="Modules" value={counts.modules} />
              <Stat label="Use cases" value={counts.useCases} />
              <Stat label="Events" value={counts.events} />
            </Grid>
          )
        : <AppNotRead app={app} />}
      <AppOverviewSystem />
      {structure && <AppOverviewUseCases app={app} />}
      {structure && (
        <Grid columns={{ base: 1, md: 2, lg: 3 }}>
          <AppOverviewFailures app={app} />
          <AppOverviewRetries app={app} />
          <AppOverviewQueues app={app} />
        </Grid>
      )}
      {structure && (
        <Grid columns={{ base: 1, lg: structure.description.contexts.length > 1 ? 2 : 1 }}>
          {structure.description.contexts.length > 1 && (
            <AppGraph title="How its contexts use each other" graph={() => contextsGraph(app.id, structure.description)} />
          )}
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
        </Grid>
      )}
    </Stack>
  )
}
