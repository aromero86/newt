import { Fragment } from 'react'
import { useParams } from 'react-router'
import { CableIcon, ClockIcon, EarIcon, MegaphoneIcon, PlayIcon } from 'lucide-react'
import { Badge } from 'newt-react-ui/badge'
import { Box, BoxEmpty, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from 'newt-react-ui/box'
import { Counter } from 'newt-react-ui/counter'
import { Icon } from 'newt-react-ui/icon'
import { TextLink } from 'newt-react-ui/link'
import { Stack } from 'newt-react-ui/stack'
import { Subhead } from 'newt-react-ui/subhead'
import { Mono } from 'newt-react-ui/text'
import type { ApplicationDescription, ModuleDependency } from '../../../api/structure'
import { NotFound } from '../../not-found/not-found'
import { contextHref, findModule, moduleHref, reactionsOf, writtenModuleId } from '../app-structure'

/** A module: its use cases, the events it tells, what it depends on and what it reacts to. */
export function AppModule({ appId, description }: { appId: string, description: ApplicationDescription }) {
  const { context, module: name } = useParams()
  const module = findModule(description, context!, name!)
  if (!module) return <NotFound />
  const reactions = reactionsOf(description)
  const heard = (eventId: string) => reactions.filter(reaction => reaction.event === eventId)
  const reactsTo = reactions.filter(reaction => reaction.handlerModule?.id === module.id)
  const link = (moduleId: string) => <TextLink href={moduleHref(appId, moduleId)}>{moduleId}</TextLink>

  return (
    <Stack gap={4}>
      <Subhead
        title={module.name}
        description={<><Mono>{module.className}</Mono>, a module of <TextLink href={contextHref(appId, module.context)}>{module.context}</TextLink></>}
      />
      <Box label="Use cases">
        <BoxHeader>Use cases <Counter>{module.useCases.length}</Counter></BoxHeader>
        {module.useCases.length === 0 && <BoxEmpty icon={PlayIcon} title="No use cases" />}
        {module.useCases.map(useCase => (
          <BoxRow key={useCase.id} leading={<Icon icon={PlayIcon} tone="muted" />}>
            <BoxRowTitle><Mono>{useCase.name}</Mono></BoxRowTitle>
            <BoxRowMeta>
              <>{useCase.writesTo.length ? <>writes also to {useCase.writesTo.map((target, index) => <Fragment key={target}>{index > 0 && ', '}{link(writtenModuleId(module.context, target))}</Fragment>)}</> : 'writes only to its own module'}</>
              <>{useCase.retryOnConflict ? 'retried on a conflict' : 'never retried on a conflict'}</>
            </BoxRowMeta>
          </BoxRow>
        ))}
      </Box>
      <Box label="Events it tells">
        <BoxHeader>Events it tells <Counter>{module.events.length}</Counter></BoxHeader>
        {module.events.length === 0 && <BoxEmpty icon={MegaphoneIcon} title="No events" />}
        {module.events.map(event => {
          const listeners = heard(event.id)
          return (
            <BoxRow key={event.id} leading={<Icon icon={event.schedule ? ClockIcon : MegaphoneIcon} tone="muted" />} trailing={event.schedule ? <Badge tone="info">{event.schedule.cron}</Badge> : undefined}>
              <BoxRowTitle><Mono>{event.name}</Mono></BoxRowTitle>
              <BoxRowMeta>
                {event.schedule && <>a schedule</>}
                <>{listeners.length
                  ? <>heard by {listeners.map((listener, index) => <Fragment key={listener.queue ?? index}>{index > 0 && ', '}{listener.handlerModule ? <TextLink href={moduleHref(appId, listener.handlerModule.id)}>{listener.handler}</TextLink> : (listener.handler ?? 'a fire-and-forget handler')}</Fragment>)}</>
                  : 'heard by nobody'}</>
              </BoxRowMeta>
            </BoxRow>
          )
        })}
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
