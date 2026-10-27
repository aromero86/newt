import { Fragment, useEffect } from 'react'
import { useParams } from 'react-router'
import { BoxIcon, EarIcon } from 'lucide-react'
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
import type { ApplicationDescription } from '../../../api/structure'
import { NotFound } from '../../not-found/not-found'
import { AppService } from '../app.service'
import { AppRemovedRow, AppRemovedToggle, useRemoved } from '../app-removed/app-removed'
import { contextHref, findContext, moduleHref, reactionsOf } from '../app-structure'

/** A context: its modules, and who hears its events. */
export function AppContext({ appId, description }: { appId: string, description: ApplicationDescription }) {
  const name = useParams().context!
  const context = findContext(description, name)
  const removed = useRemoved().filter(item => item.context === name)
  if (!context) return <AppGoneContext appId={appId} name={name} />
  const reactions = reactionsOf(description).filter(reaction => reaction.context === name)

  return (
    <Stack gap={4}>
      <Subhead
        title={context.name}
        actions={<AppRemovedToggle />}
        description={context.uses.length
          ? <>Its modules use those of {context.uses.map((used, index) => <Fragment key={used}>{index > 0 && ', '}<TextLink href={contextHref(appId, used)}>{used}</TextLink></Fragment>)}.</>
          : 'Its modules use no other context.'}
      />
      <Box label="Modules">
        <BoxHeader>Modules <Counter>{context.modules.length}</Counter></BoxHeader>
        {context.modules.map(module => (
          <BoxRow key={module.id} leading={<Icon icon={BoxIcon} tone="muted" />}>
            <BoxRowTitle href={moduleHref(appId, module.id)}>{module.name}</BoxRowTitle>
            <BoxRowMeta>
              <>{module.useCases.length} use cases</>
              <>{module.events.length} events</>
              <>{module.deps.length} deps</>
            </BoxRowMeta>
          </BoxRow>
        ))}
        {removed.filter(item => item.kind === 'module').map(item => <AppRemovedRow key={item.id} item={item} href={moduleHref(appId, item.itemId)} />)}
      </Box>
      <Box label="Who hears its events">
        <BoxHeader>Who hears its events <Counter>{reactions.length}</Counter></BoxHeader>
        {reactions.length === 0 && <BoxEmpty icon={EarIcon} title="Nobody" description="No handler listens to the events this context tells." />}
        {reactions.map(reaction => (
          <BoxRow key={`${reaction.event}:${reaction.queue ?? reaction.strategy}`} leading={<Icon icon={EarIcon} tone="muted" />}>
            <BoxRowTitle href={reaction.handlerModule ? moduleHref(appId, reaction.handlerModule.id) : undefined}>
              {reaction.handler ?? 'A fire-and-forget handler'}
            </BoxRowTitle>
            <BoxRowMeta>
              <>on <Mono>{reaction.event}</Mono></>
              {reaction.handlerModule && reaction.handlerModule.context !== name && <>in {reaction.handlerModule.context}</>}
              <>{reaction.strategy === 'handler' ? `a job in queue ${reaction.queue}` : 'fire-and-forget: no job'}</>
              {reaction.filtered && <>only when it says so</>}
              {reaction.attempts !== null && <>{reaction.attempts} attempts</>}
            </BoxRowMeta>
          </BoxRow>
        ))}
      </Box>
    </Stack>
  )
}

/** A context the last version has not: what it had, kept. */
function AppGoneContext({ appId, name }: { appId: string, name: string }) {
  const service = useService(AppService)
  const removed = useValue(service.removed)

  useEffect(() => {
    void service.loadRemoved()
  }, [service])

  if (removed === null) return <Spinner label="Loading what was removed" />
  const items = removed.filter(item => item.context === name)
  const context = items.find(item => item.kind === 'context')
  if (!context) return <NotFound />
  return (
    <Stack gap={4}>
      <Subhead title={<>{name} <Badge tone="warn">Removed</Badge></>} description={<>Gone <RelativeTime date={context.archivedAt!} />: what it had is kept.</>} />
      <Box label="Its modules">
        <BoxHeader>Its modules <Counter>{items.filter(item => item.kind === 'module').length}</Counter></BoxHeader>
        {items.filter(item => item.kind === 'module').map(item => <AppRemovedRow key={item.id} item={item} href={moduleHref(appId, item.itemId)} />)}
      </Box>
    </Stack>
  )
}
