import { Fragment, useEffect } from 'react'
import { useParams } from 'react-router'
import { CableIcon, ClockIcon, EarIcon, MegaphoneIcon, PlayIcon } from 'lucide-react'
import { Badge } from 'newt-react-ui/badge'
import { Box, BoxEmpty, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from 'newt-react-ui/box'
import { Counter } from 'newt-react-ui/counter'
import { Icon } from 'newt-react-ui/icon'
import { TextLink } from 'newt-react-ui/link'
import { RelativeTime } from 'newt-react-ui/relative-time'
import { Spinner } from 'newt-react-ui/spinner'
import { Stack } from 'newt-react-ui/stack'
import { Subhead } from 'newt-react-ui/subhead'
import { Mono } from 'newt-react-ui/text'
import { useService, useValue } from 'newt-react'
import type { ApplicationDescription, ModuleDependency } from '../../../api/structure'
import { NotFound } from '../../not-found/not-found'
import { describeEnded, describeEventTotal, describeUseCaseTotal, useEventTotals, useUseCaseEnded, useUseCaseTotals } from '../app-metrics/metrics-totals'
import { AppRemovedRow, AppRemovedToggle, useRemoved } from '../app-removed/app-removed'
import { AppService } from '../app.service'
import { AppGraph } from '../app-graph/app-graph'
import { contextHref, findModule, moduleHref, moduleNeighbourhood, reactionsOf, writtenModuleId } from '../app-structure'

/** A module: its use cases and the events it tells, each with its last 24 hours and a link to its metrics; what it depends on and what it reacts to. */
export function AppModule({ appId, description }: { appId: string, description: ApplicationDescription }) {
  const { context, module: name } = useParams()
  const totals = useUseCaseTotals(appId)
  const ended = useUseCaseEnded(appId)
  const told = useEventTotals(appId)
  const module = findModule(description, context!, name!)
  const removed = useRemoved().filter(item => item.context === context && item.module === name)
  if (!module) return <AppGoneModule appId={appId} context={context!} name={name!} />
  const reactions = reactionsOf(description)
  const heard = (eventId: string) => reactions.filter(reaction => reaction.event === eventId)
  const reactsTo = reactions.filter(reaction => reaction.handlerModule?.id === module.id)
  const link = (moduleId: string) => <TextLink href={moduleHref(appId, moduleId)}>{moduleId}</TextLink>

  return (
    <Stack gap={4}>
      <Subhead
        title={module.name}
        description={<><Mono>{module.className}</Mono>, a module of <TextLink href={contextHref(appId, module.context)}>{module.context}</TextLink></>}
        actions={<AppRemovedToggle />}
      />
      <AppGraph title="What it uses, and what uses it" reactions graph={withReactions => moduleNeighbourhood(appId, description, module.id, withReactions)} />
      <Box label="Use cases">
        <BoxHeader>Use cases <Counter>{module.useCases.length}</Counter></BoxHeader>
        {module.useCases.length === 0 && <BoxEmpty icon={PlayIcon} title="No use cases" />}
        {module.useCases.map(useCase => (
          <BoxRow key={useCase.id} leading={<Icon icon={PlayIcon} tone="muted" />}>
            <BoxRowTitle href={`/apps/${appId}/use-cases/${module.context}/${useCase.name}`}><Mono>{useCase.name}</Mono></BoxRowTitle>
            <BoxRowMeta>
              {totals && <>{describeUseCaseTotal(totals.get(`${module.context}|${useCase.name}`))}</>}
              {ended && describeEnded(ended.get(`${module.context}|${useCase.name}`)) && <>{describeEnded(ended.get(`${module.context}|${useCase.name}`))}</>}
              <>{useCase.writesTo.length ? <>writes also to {useCase.writesTo.map((target, index) => <Fragment key={target}>{index > 0 && ', '}{link(writtenModuleId(module.context, target))}</Fragment>)}</> : 'writes only to its own module'}</>
              <>{useCase.retryOnConflict ? 'retried on a conflict' : 'never retried on a conflict'}</>
            </BoxRowMeta>
          </BoxRow>
        ))}
        {removed.filter(item => item.kind === 'useCase').map(item => <AppRemovedRow key={item.id} item={item} />)}
      </Box>
      <Box label="Events it tells">
        <BoxHeader>Events it tells <Counter>{module.events.length}</Counter></BoxHeader>
        {module.events.length === 0 && <BoxEmpty icon={MegaphoneIcon} title="No events" />}
        {module.events.map(event => {
          const listeners = heard(event.id)
          return (
            <BoxRow key={event.id} leading={<Icon icon={event.schedule ? ClockIcon : MegaphoneIcon} tone="muted" />} trailing={event.schedule ? <Badge tone="info">{event.schedule.cron}</Badge> : undefined}>
              <BoxRowTitle href={`/apps/${appId}/events/${module.context}/${event.name}`}><Mono>{event.name}</Mono></BoxRowTitle>
              <BoxRowMeta>
                {event.schedule && <>a schedule</>}
                {told && <>{describeEventTotal(told.get(`${module.context}|${event.name}`))}</>}
                <>{listeners.length
                  ? <>heard by {listeners.map((listener, index) => <Fragment key={listener.queue ?? index}>{index > 0 && ', '}{listener.handlerModule ? <TextLink href={moduleHref(appId, listener.handlerModule.id)}>{listener.handler}</TextLink> : (listener.handler ?? 'a fire-and-forget handler')}</Fragment>)}</>
                  : 'heard by nobody'}</>
              </BoxRowMeta>
            </BoxRow>
          )
        })}
        {removed.filter(item => item.kind === 'event').map(item => <AppRemovedRow key={item.id} item={item} />)}
      </Box>
      <Box label="Depends on">
        <BoxHeader>Depends on <Counter>{module.deps.length}</Counter></BoxHeader>
        {module.deps.length === 0 && <BoxEmpty icon={CableIcon} title="Nothing" description="It needs no other module." />}
        {module.deps.map(dep => (
          <BoxRow key={dep.name} leading={<Icon icon={CableIcon} tone="muted" />}>
            <BoxRowTitle><Mono>{dep.name}</Mono></BoxRowTitle>
            <BoxRowMeta><AppModuleDependency appId={appId} dep={dep} /></BoxRowMeta>
          </BoxRow>
        ))}
      </Box>
      <Box label="Reacts to">
        <BoxHeader>Reacts to <Counter>{reactsTo.length}</Counter></BoxHeader>
        {reactsTo.length === 0 && <BoxEmpty icon={EarIcon} title="Nothing" description="None of its use cases handles an event." />}
        {reactsTo.map(reaction => (
          <BoxRow key={reaction.queue ?? reaction.event} leading={<Icon icon={EarIcon} tone="muted" />}>
            <BoxRowTitle><Mono>{reaction.event}</Mono></BoxRowTitle>
            <BoxRowMeta>
              <>with <Mono>{reaction.handler}</Mono></>
              <>a job in queue {reaction.queue}</>
              {reaction.filtered && <>only when it says so</>}
              {reaction.attempts !== null && <>{reaction.attempts} attempts</>}
            </BoxRowMeta>
          </BoxRow>
        ))}
      </Box>
    </Stack>
  )
}

/** What one of its deps is: another module, the events of one, or a port. */
function AppModuleDependency({ appId, dep }: { appId: string, dep: ModuleDependency }) {
  if (dep.kind === 'module') return <>the module <TextLink href={moduleHref(appId, dep.target)}>{dep.target}</TextLink></>
  if (dep.kind === 'events') {
    return <>the events {dep.events.join(', ')} of {dep.target ? <TextLink href={moduleHref(appId, dep.target)}>{dep.target}</TextLink> : 'a context not described'}</>
  }
  return <>a port: an object in its own words</>
}

/** A module the last version has not: its use cases and events, kept. */
function AppGoneModule({ appId, context, name }: { appId: string, context: string, name: string }) {
  const service = useService(AppService)
  const removed = useValue(service.removed)

  useEffect(() => {
    void service.loadRemoved()
  }, [service])

  if (removed === null) return <Spinner label="Loading what was removed" />
  const items = removed.filter(item => item.context === context && item.module === name)
  const module = items.find(item => item.kind === 'module')
  if (!module) return <NotFound />
  return (
    <Stack gap={4}>
      <Subhead
        title={<>{name} <Badge tone="warn">Removed</Badge></>}
        description={<>A module of <TextLink href={contextHref(appId, context)}>{context}</TextLink>, gone <RelativeTime date={module.archivedAt!} />: what it had is kept.</>}
      />
      <Box label="Its use cases">
        <BoxHeader>Its use cases <Counter>{items.filter(item => item.kind === 'useCase').length}</Counter></BoxHeader>
        {items.filter(item => item.kind === 'useCase').map(item => <AppRemovedRow key={item.id} item={item} />)}
      </Box>
      <Box label="Its events">
        <BoxHeader>Its events <Counter>{items.filter(item => item.kind === 'event').length}</Counter></BoxHeader>
        {items.filter(item => item.kind === 'event').map(item => <AppRemovedRow key={item.id} item={item} />)}
      </Box>
    </Stack>
  )
}
